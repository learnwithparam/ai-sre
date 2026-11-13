// A tiny OTLP/HTTP JSON receiver. A check points the learner's service at it and reads what
// arrives.
export type SpanRow = {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  kind: number;
  resource: Record<string, unknown>;
  attributes: Record<string, unknown>;
  status: number;
};
export type LogRow = {
  traceId: string;
  body: string;
  severity: string;
  resource: Record<string, unknown>;
  attributes: Record<string, unknown>;
};

// The parts of the OTLP JSON format this receiver reads. Field names are the wire names.
type AnyValue = {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values?: AnyValue[] };
  kvlistValue?: { values?: KeyValue[] };
};
type KeyValue = { key: string; value?: AnyValue };
type Resource = { attributes?: KeyValue[] };
type OtlpSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  attributes?: KeyValue[];
  status?: { code?: number };
};
type OtlpLog = {
  traceId?: string;
  body?: AnyValue;
  severityText?: string;
  attributes?: KeyValue[];
};
type TraceExport = {
  resourceSpans?: { resource?: Resource; scopeSpans?: { spans?: OtlpSpan[] }[] }[];
};
type LogExport = {
  resourceLogs?: { resource?: Resource; scopeLogs?: { logRecords?: OtlpLog[] }[] }[];
};

function plainValue(wireValue: AnyValue | null | undefined): unknown {
  if (wireValue == null) return null;
  const simple =
    wireValue.stringValue ?? wireValue.intValue ?? wireValue.doubleValue ?? wireValue.boolValue;
  if (simple !== undefined && simple !== null) return simple;
  if (wireValue.arrayValue) return (wireValue.arrayValue.values ?? []).map(plainValue);
  if (wireValue.kvlistValue) return plainAttributes(wireValue.kvlistValue.values);
  return null;
}

function plainAttributes(keyValues: KeyValue[] = []): Record<string, unknown> {
  const pairs = keyValues.map((keyValue) => [keyValue.key, plainValue(keyValue.value)]);
  return Object.fromEntries(pairs);
}

function spanRow(span: OtlpSpan, resource?: Resource): SpanRow {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId ?? "",
    name: span.name,
    kind: span.kind,
    resource: plainAttributes(resource?.attributes),
    attributes: plainAttributes(span.attributes),
    status: span.status?.code ?? 0,
  };
}

function collectSpans(body: TraceExport, spans: SpanRow[]): void {
  for (const resourceSpans of body.resourceSpans ?? []) {
    for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
      for (const span of scopeSpans.spans ?? []) spans.push(spanRow(span, resourceSpans.resource));
    }
  }
}

function logRow(log: OtlpLog, resource?: Resource): LogRow {
  return {
    traceId: log.traceId ?? "",
    body: String(plainValue(log.body) ?? ""),
    severity: log.severityText ?? "",
    resource: plainAttributes(resource?.attributes),
    attributes: plainAttributes(log.attributes),
  };
}

function collectLogs(body: LogExport, logs: LogRow[]): void {
  for (const resourceLogs of body.resourceLogs ?? []) {
    for (const scopeLogs of resourceLogs.scopeLogs ?? []) {
      for (const log of scopeLogs.logRecords ?? []) logs.push(logRow(log, resourceLogs.resource));
    }
  }
}

export function startReceiver() {
  const spans: SpanRow[] = [];
  const logs: LogRow[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      const body = await request.json().catch(() => ({}));
      if (url.pathname === "/v1/traces") collectSpans(body as TraceExport, spans);
      else if (url.pathname === "/v1/logs") collectLogs(body as LogExport, logs);
      return new Response("{}", { headers: { "content-type": "application/json" } });
    },
  });
  const stop = () => server.stop(true);
  return { url: `http://127.0.0.1:${server.port}`, spans, logs, stop };
}
