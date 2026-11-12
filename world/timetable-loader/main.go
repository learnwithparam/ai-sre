// timetable-loader: tide windows for each Gullrock route, so the booking page can warn about low water.
// A request for a very long range builds the table in memory and never returns: the timetable-hang fault.
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

func setup(ctx context.Context) func() {
	res := resource.NewWithAttributes(semconv.SchemaURL,
		semconv.ServiceName("timetable-loader"),
		semconv.ServiceVersion(getenv("TIMETABLE_RELEASE", "t3")),
	)
	traceExp, err := otlptracehttp.New(ctx)
	if err != nil {
		panic(err)
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(traceExp, sdktrace.WithBatchTimeout(time.Second)), sdktrace.WithResource(res))
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})

	logExp, err := otlploghttp.New(ctx)
	if err != nil {
		panic(err)
	}
	lp := sdklog.NewLoggerProvider(sdklog.WithProcessor(sdklog.NewBatchProcessor(logExp, sdklog.WithExportInterval(time.Second))), sdklog.WithResource(res))
	global.SetLoggerProvider(lp)
	logger = otelslog.NewLogger("timetable-loader")
	return func() { _ = tp.Shutdown(ctx); _ = lp.Shutdown(ctx) }
}

func getenv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

type window struct {
	Day     int    `json:"day"`
	LowFrom string `json:"low_water_from"`
	LowTo   string `json:"low_water_to"`
}

func tides(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	route := r.URL.Query().Get("route")
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days < 1 {
		days = 1
	}
	logger.InfoContext(ctx, "request received: GET /tides "+route, "route", route, "days", days)
	var table [][]byte
	out := []window{}
	if days > 30 {
		ref := ""
		if code := os.Getenv("FAULT_CODE"); code != "" {
			ref = " ref=" + code
		}
		logger.WarnContext(ctx, "building tide table for "+strconv.Itoa(days)+" days from the raw harmonic table"+ref, "route", route)
	}
	for d := 0; d < days; d++ {
		if days > 30 {
			// Ranges over 30 are built from the raw harmonic table, 1 MB per step, and the loop
			// waits on a cache that is never filled. The request never completes.
			table = append(table, make([]byte, 1<<20))
			time.Sleep(50 * time.Millisecond)
			d = 0
			continue
		}
		h := (d*50 + len(route)*7) % 24
		out = append(out, window{Day: d, LowFrom: strconv.Itoa(h) + ":10", LowTo: strconv.Itoa((h+2)%24) + ":40"})
	}
	_ = table
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"route": route, "windows": out})
	logger.InfoContext(ctx, "request completed: GET /tides "+route, "route", route)
}

func main() {
	ctx := context.Background()
	shutdown := setup(ctx)
	defer shutdown()
	mux := http.NewServeMux()
	mux.Handle("/tides", otelhttp.NewHandler(http.HandlerFunc(tides), "GET /tides"))
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"ok":true}`)) })
	port := getenv("PORT", "8001")
	logger.Info("** Service Started on Port " + port + " **")
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		logger.Error(err.Error())
	}
}
