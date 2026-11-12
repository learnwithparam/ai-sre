// list-the-services: the learner's SQL runs against a recorded morning at Gullrock (or the live world),
// and its rows are compared with the reference query's rows.
import type { Rule } from "../scripts/verify";
import { read } from "./lib/files";
import { query, sourceFor } from "./lib/world";

const FILE = "list-the-services.sql";
const REFERENCE = `SELECT ServiceName AS service, count() AS spans, countIf(StatusCode = 'Error') AS error_spans
FROM otel_traces WHERE Timestamp > now() - INTERVAL 60 MINUTE GROUP BY service ORDER BY spans DESC`;

type Row = { service: string; spans: number; error_spans: number };
const cache = new Map<string, Promise<{ mine: Row[]; ref: Row[]; error: string }>>();
function run(dir: string) {
  if (!cache.has(dir)) cache.set(dir, (async () => {
    const sql = read(dir, FILE);
    const ref = await query<Row>(dir, REFERENCE);
    try { return { mine: await query<Row>(dir, sql), ref, error: "" }; }
    catch (e) { return { mine: [], ref, error: (e as Error).message }; }
  })());
  return cache.get(dir)!;
}
const isRead = (sql: string) => /^\s*(--[^\n]*\n\s*)*(select|with)\b/i.test(sql);

export default [
  { says: `${FILE} holds one SELECT`, test: (d) => isRead(read(d, FILE)), tryNext: `write a SELECT in ${FILE}; it is the only statement in the file` },
  { says: "the query runs", test: async (d) => (await run(d)).error === "", tryNext: "run the query in HyperDX's SQL view and fix the error it shows; then run this again" },
  {
    says: "it returns the columns service, spans and error_spans",
    test: async (d) => { const r = (await run(d)).mine[0]; return !!r && ["service", "spans", "error_spans"].every((c) => c in r); },
    tryNext: "name the columns with AS: ServiceName AS service, count() AS spans, and the error count AS error_spans",
  },
  {
    says: "one row per service that sent spans in the last 60 minutes",
    test: async (d) => { const { mine, ref } = await run(d); return mine.length === ref.length && new Set(mine.map((r) => r.service)).size === ref.length; },
    tryNext: "GROUP BY the service, and keep only spans from the last 60 minutes: WHERE Timestamp > now() - INTERVAL 60 MINUTE",
  },
  {
    says: "the busiest service comes first",
    test: async (d) => { const { mine, ref } = await run(d); return mine[0]?.service === ref[0]?.service; },
    tryNext: "ORDER BY spans DESC, so the service with the most spans is the first row",
  },
  {
    says: "span and error counts match the telemetry",
    test: async (d) => {
      const { mine, ref } = await run(d);
      // Live traffic keeps arriving between the two queries, so live counts may differ by 2%.
      const slack = sourceFor(d).kind === "live" ? 0.02 : 0;
      const near = (a: number, b: number) => Math.abs(a - b) <= Math.ceil(b * slack);
      return ref.every((r) => { const m = mine.find((x) => x.service === r.service); return !!m && near(Number(m.spans), Number(r.spans)) && near(Number(m.error_spans), Number(r.error_spans)); });
    },
    tryNext: "count spans with count() and errors with countIf(StatusCode = 'Error'); the value is case sensitive, so look at one row first",
  },
  {
    says: "it reads the world you are checking against",
    test: async (d) => sourceFor(d).kind === "recorded" || (await run(d)).ref.length > 0,
    tryNext: "start the world with bun run world and wait a minute for traffic, then run this again",
  },
] satisfies Rule[];
