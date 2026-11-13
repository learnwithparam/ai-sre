// Runs one pretend incident through a learner's genai.ts and keeps every span it made.
// The incident has two model calls that answer and one that fails, all inside one trace.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { context, type Tracer, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";

type Answer = { responseModel: string; inputTokens: number; outputTokens: number };
type Genai = {
  traceModelCall: (
    tracer: Tracer,
    call: { provider: string; requestModel: string },
    run: () => Promise<Answer>,
  ) => Promise<Answer>;
};

export type Incident = { traceId: string; spans: ReadableSpan[] };

const CALL = { provider: "anthropic", requestModel: "fixture-model" };
const ANSWER: Answer = { responseModel: "fixture-model-2026", inputTokens: 120, outputTokens: 40 };

class RateLimitError extends Error {
  override name = "RateLimitError";
}

// A fixture call that fails, so error.type has something to record.
const failing = async (): Promise<Answer> => {
  throw new RateLimitError("429 too many requests");
};

export async function runIncident(folder: string): Promise<Incident | null> {
  const file = join(folder, "genai.ts");
  if (!existsSync(file)) return null;
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  const helper = (await import(file)) as Genai;
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
  const tracer = provider.getTracer("ai-sre");
  const incident = tracer.startSpan("incident run");
  const inIncident = trace.setSpan(context.active(), incident);
  await context.with(inIncident, async () => {
    await helper.traceModelCall(tracer, CALL, async () => ANSWER);
    await helper.traceModelCall(tracer, CALL, async () => ANSWER);
    await helper.traceModelCall(tracer, CALL, failing).catch(() => undefined);
  });
  incident.end();
  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();
  return { traceId: incident.spanContext().traceId, spans };
}

// Every span that is a model call, which is every span except the incident span.
export const modelCalls = (incident: Incident) =>
  incident.spans.filter((span) => span.name !== "incident run");

// ClickStack keeps spans in a ClickHouse table named otel_traces. This names the incident's spans
// otel_traces in embedded ClickHouse, so a real ClickStack query runs on them.
export async function queryAsClickstack(
  incident: Incident,
  sql: string,
): Promise<Record<string, unknown>[]> {
  // biome-ignore-start lint/style/useNamingConvention: these are ClickStack column names.
  const rows = incident.spans.map((span) => ({
    Timestamp: new Date(span.startTime[0] * 1000 + span.startTime[1] / 1e6).toISOString(),
    TraceId: span.spanContext().traceId,
    SpanId: span.spanContext().spanId,
    SpanName: span.name,
    ServiceName: "ai-sre",
    StatusCode: span.status.code === 2 ? "Error" : "Unset",
    SpanAttributes: Object.fromEntries(
      Object.entries(span.attributes).map(([key, value]) => [key, String(value)]),
    ),
  }));
  // biome-ignore-end lint/style/useNamingConvention: these are ClickStack column names.
  const body = rows
    .map((row) => JSON.stringify(row))
    .join("\n")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
  const shape =
    "Timestamp DateTime64(9), TraceId String, SpanId String, SpanName String, " +
    "ServiceName String, StatusCode String, SpanAttributes Map(String, String)";
  const table = `WITH otel_traces AS (SELECT * FROM format(JSONEachRow, '${shape}', '${body}'))`;
  // Embedded ClickHouse allows one open session per process, and the recorded worlds hold one,
  // so the query runs in its own process.
  const script = join(import.meta.dir, "clickstack-query.ts");
  const done = Bun.spawnSync(["bun", script], {
    stdin: new TextEncoder().encode(`${table} ${sql}`),
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = done.stdout.toString().trim();
  return text ? text.split("\n").map((line) => JSON.parse(line)) : [];
}
