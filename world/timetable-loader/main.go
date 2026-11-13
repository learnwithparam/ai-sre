// timetable-loader: tide windows for each Gullrock route,
// so the booking page can warn about low water.
// A request for a very long range builds the table in memory and never returns:
// the timetable-hang fault.
package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/log/global"
	"go.opentelemetry.io/otel/propagation"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.37.0"
)

var logger *slog.Logger

// setup sends traces and logs to the collector and returns a function that flushes them on exit.
func setup(background context.Context) func() {
	serviceResource := resource.NewWithAttributes(semconv.SchemaURL,
		semconv.ServiceName("timetable-loader"),
		semconv.ServiceVersion(getenv("TIMETABLE_RELEASE", "t3")),
	)
	traceExporter, err := otlptracehttp.New(background)
	if err != nil {
		panic(err)
	}
	spanBatcher := sdktrace.WithBatcher(traceExporter, sdktrace.WithBatchTimeout(time.Second))
	tracerProvider := sdktrace.NewTracerProvider(spanBatcher, sdktrace.WithResource(serviceResource))
	otel.SetTracerProvider(tracerProvider)
	otel.SetTextMapPropagator(propagation.TraceContext{})

	logExporter, err := otlploghttp.New(background)
	if err != nil {
		panic(err)
	}
	logBatcher := sdklog.NewBatchProcessor(logExporter, sdklog.WithExportInterval(time.Second))
	loggerProvider := sdklog.NewLoggerProvider(
		sdklog.WithProcessor(logBatcher),
		sdklog.WithResource(serviceResource),
	)
	global.SetLoggerProvider(loggerProvider)
	logger = otelslog.NewLogger("timetable-loader")
	return func() {
		_ = tracerProvider.Shutdown(background)
		_ = loggerProvider.Shutdown(background)
	}
}

func getenv(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

type window struct {
	Day     int    `json:"day"`
	LowFrom string `json:"low_water_from"`
	LowTo   string `json:"low_water_to"`
}

func warnAboutLongRange(requestContext context.Context, route string, days int) {
	faultRef := ""
	if code := os.Getenv("FAULT_CODE"); code != "" {
		faultRef = " ref=" + code
	}
	message := "building tide table for " + strconv.Itoa(days) +
		" days from the raw harmonic table" + faultRef
	logger.WarnContext(requestContext, message, "route", route)
}

func tides(writer http.ResponseWriter, request *http.Request) {
	requestContext := request.Context()
	route := request.URL.Query().Get("route")
	days, _ := strconv.Atoi(request.URL.Query().Get("days"))
	if days < 1 {
		days = 1
	}
	logger.InfoContext(requestContext, "request received: GET /tides "+route,
		"route", route, "days", days)
	var table [][]byte
	windows := []window{}
	if days > 30 {
		warnAboutLongRange(requestContext, route, days)
	}
	for day := 0; day < days; day++ {
		if days > 30 {
			// Ranges over 30 are built from the raw harmonic table, 1 MB per step, and the loop
			// waits on a cache that is never filled. The request never completes.
			table = append(table, make([]byte, 1<<20))
			time.Sleep(50 * time.Millisecond)
			day = 0
			continue
		}
		lowWaterHour := (day*50 + len(route)*7) % 24
		windows = append(windows, window{
			Day:     day,
			LowFrom: strconv.Itoa(lowWaterHour) + ":10",
			LowTo:   strconv.Itoa((lowWaterHour+2)%24) + ":40",
		})
	}
	_ = table
	writer.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(writer).Encode(map[string]any{"route": route, "windows": windows})
	logger.InfoContext(requestContext, "request completed: GET /tides "+route, "route", route)
}

func health(writer http.ResponseWriter, _ *http.Request) {
	_, _ = writer.Write([]byte(`{"ok":true}`))
}

func main() {
	shutdown := setup(context.Background())
	defer shutdown()
	router := http.NewServeMux()
	router.Handle("/tides", otelhttp.NewHandler(http.HandlerFunc(tides), "GET /tides"))
	router.HandleFunc("/health", health)
	port := getenv("PORT", "8001")
	logger.Info("** Service Started on Port " + port + " **")
	if err := http.ListenAndServe(":"+port, router); err != nil {
		logger.Error(err.Error())
	}
}
