// Telemetry plumbing for booking-web. Three small hooks in hooks/ hold the parts you change in part one;
// BOOKING_HOOKS_DIR points at a step folder to load your version of a hook instead of the finished one.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { context, logs, propagation, SeverityNumber, trace, type Attributes } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { BatchSpanProcessor, TracerProvider, type ReadableSpan, type SpanExporter } from "@opentelemetry/sdk-trace";
import { BatchLogRecordProcessor, LoggerProvider, type LogRecordProcessor, type ReadWriteLogRecord } from "@opentelemetry/sdk-logs";

type Hooks = {
  telemetry: typeof import("./hooks/telemetry");
  checkin: typeof import("./hooks/checkin");
  redact: typeof import("./hooks/redact");
};

export async function loadHooks(env = process.env): Promise<Hooks> {
  const pick = async (name: string) => {
    const mine = env.BOOKING_HOOKS_DIR ? join(env.BOOKING_HOOKS_DIR, `${name}.ts`) : "";
    return import(mine && existsSync(mine) ? mine : join(import.meta.dir, "hooks", `${name}.ts`));
  };
  return { telemetry: await pick("telemetry"), checkin: await pick("checkin"), redact: await pick("redact") };
}

// Applies the redact hook to every span on its way out, so nothing unredacted reaches the collector.
class RedactingExporter implements SpanExporter {
  constructor(private inner: SpanExporter, private redact: Hooks["redact"]) {}
  export(spans: ReadableSpan[], done: Parameters<SpanExporter["export"]>[1]) {
    const clean = spans.map((s) => {
      const copy = Object.create(s) as ReadableSpan;
      Object.defineProperty(copy, "attributes", { value: this.redact.redactAttributes({ ...s.attributes }) });
      return copy;
    });
    this.inner.export(clean, done);
  }
  shutdown() { return this.inner.shutdown(); }
  forceFlush() { return this.inner.forceFlush?.() ?? Promise.resolve(); }
}

class RedactingLogs implements LogRecordProcessor {
  constructor(private redact: Hooks["redact"]) {}
  onEmit(record: ReadWriteLogRecord) {
    if (typeof record.body === "string") record.setBody(this.redact.redactBody(record.body));
    const attrs = this.redact.redactAttributes({ ...record.attributes });
    for (const [k, v] of Object.entries(attrs)) record.setAttribute(k, v as never);
  }
  forceFlush() { return Promise.resolve(); }
  shutdown() { return Promise.resolve(); }
}

export function startTelemetry(hooks: Hooks, env = process.env) {
  const base = (env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318").replace(/\/$/, "");
  const headers = env.HYPERDX_API_KEY ? { authorization: env.HYPERDX_API_KEY } : {};
  const resource = hooks.telemetry.bookingResource(env);
  const delay = Number(env.OTEL_EXPORT_DELAY_MS ?? 1000);

  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  const traces = new TracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor({
        exporter: new RedactingExporter(new OTLPTraceExporter({ url: `${base}/v1/traces`, headers }), hooks.redact),
        scheduledDelayMillis: delay,
      }),
    ],
  });
  trace.setGlobalTracerProvider(traces);

  const logProvider = new LoggerProvider({
    resource,
    processors: [
      new RedactingLogs(hooks.redact),
      new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: `${base}/v1/logs`, headers }), scheduledDelayMillis: delay }),
    ],
  });
  logs.setGlobalLoggerProvider(logProvider);

  return {
    flush: async () => { await traces.forceFlush(); await logProvider.forceFlush(); },
  };
}

const LEVELS = {
  info: [SeverityNumber.INFO, "info"],
  warn: [SeverityNumber.WARN, "warn"],
  error: [SeverityNumber.ERROR, "error"],
} as const;

// One log line, tied to the active trace so the waterfall and the logs line up.
export function log(level: keyof typeof LEVELS, body: string, attributes: Attributes = {}) {
  const [severityNumber, severityText] = LEVELS[level];
  logs.getLogger("booking-web").emit({ severityNumber, severityText, body, attributes, context: context.active() });
  if (process.env.BOOKING_QUIET !== "1") console.log(`${severityText} ${body}`);
}
