// A tiny OTLP/HTTP JSON receiver. A check points the learner's service at it and reads what arrives.
export type SpanRow = {
  traceId: string; spanId: string; parentSpanId: string; name: string; kind: number;
  resource: Record<string, unknown>; attributes: Record<string, unknown>; status: number;
};
export type LogRow = { traceId: string; body: string; severity: string; resource: Record<string, unknown>; attributes: Record<string, unknown> };

const value = (v: any): unknown => v == null ? null : v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue ??
  (v.arrayValue ? (v.arrayValue.values ?? []).map(value) : v.kvlistValue ? attrs(v.kvlistValue.values) : null);
const attrs = (kvs: any[] = []) => Object.fromEntries(kvs.map((kv) => [kv.key, value(kv.value)]));

export function startReceiver() {
  const spans: SpanRow[] = [];
  const logs: LogRow[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const body: any = await req.json().catch(() => ({}));
      if (url.pathname === "/v1/traces") {
        for (const rs of body.resourceSpans ?? []) for (const ss of rs.scopeSpans ?? []) for (const s of ss.spans ?? []) {
          spans.push({
            traceId: s.traceId, spanId: s.spanId, parentSpanId: s.parentSpanId ?? "", name: s.name, kind: s.kind,
            resource: attrs(rs.resource?.attributes), attributes: attrs(s.attributes), status: s.status?.code ?? 0,
          });
        }
      } else if (url.pathname === "/v1/logs") {
        for (const rl of body.resourceLogs ?? []) for (const sl of rl.scopeLogs ?? []) for (const l of sl.logRecords ?? []) {
          logs.push({ traceId: l.traceId ?? "", body: String(value(l.body) ?? ""), severity: l.severityText ?? "", resource: attrs(rl.resource?.attributes), attributes: attrs(l.attributes) });
        }
      }
      return new Response("{}", { headers: { "content-type": "application/json" } });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, spans, logs, stop: () => server.stop(true) };
}
