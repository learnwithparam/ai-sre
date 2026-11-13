// open-the-slowest-trace: your SQL runs on the recorded bad-release morning. It must list
// every span of the slowest booking, and that list shows which span made it slow.

import { type Answer, answerAtMoment, isOneSelect } from "../parts/03-look-without-touching/replay";
import type { Rule } from "../scripts/verify";
import { read } from "./lib/files";

const FILE = "open-the-slowest-trace.sql";
const REFERENCE = `
SELECT TraceId AS trace_id, SpanName AS span, Duration / 1e6 AS duration_ms
FROM otel_traces
WHERE TraceId = (
    SELECT TraceId FROM otel_traces
    WHERE ServiceName = 'booking-web' AND SpanName = 'POST /api/bookings'
        AND Timestamp > now() - INTERVAL 15 MINUTE
    ORDER BY Duration DESC LIMIT 1
)
ORDER BY Timestamp`;

// biome-ignore lint/style/useNamingConvention: the columns are SQL column names.
type Row = { trace_id: string; span: string; duration_ms: number; status: string };
type Run = { mine: Answer<Row>; reference: Row[] };

const runs = new Map<string, Promise<Run>>();

async function runBothQueries(folder: string): Promise<Run> {
  const reference = await answerAtMoment<Row>("bad-release", 0, REFERENCE);
  const mine = await answerAtMoment<Row>("bad-release", 0, read(folder, FILE));
  return { mine, reference: reference.rows };
}

function run(folder: string): Promise<Run> {
  let saved = runs.get(folder);
  if (!saved) {
    saved = runBothQueries(folder);
    runs.set(folder, saved);
  }
  return saved;
}

const myRows = async (folder: string) => (await run(folder)).mine.rows;
// Spans that start in the same millisecond may come back in either order, so compare sorted.
const spanNames = (rows: Row[]) =>
  rows
    .map((row) => row.span)
    .sort()
    .join(" > ");

export default [
  {
    says: `${FILE} holds one SELECT`,
    test: (folder) => isOneSelect(read(folder, FILE)),
    tryNext: `keep one SELECT in ${FILE}; the inner SELECT in brackets belongs to it`,
  },
  {
    says: "the query runs on the recorded bad-release morning",
    test: async (folder) => (await run(folder)).mine.error === "",
    tryNext: "run the query in HyperDX's SQL view and fix the error it shows; then run this again",
  },
  {
    says: "it returns trace_id, span, duration_ms and status",
    test: async (folder) => {
      const firstRow = (await myRows(folder))[0] ?? {};
      return ["trace_id", "span", "duration_ms", "status"].every((column) => column in firstRow);
    },
    tryNext: "keep the four column names of the starter; the check reads them by name",
  },
  {
    says: "every row belongs to one trace",
    test: async (folder) => {
      const traceIds = new Set((await myRows(folder)).map((row) => row.trace_id));
      return traceIds.size === 1;
    },
    tryNext: "keep WHERE TraceId = ( one inner SELECT that ends in LIMIT 1 )",
  },
  {
    says: "the trace is the slowest booking of the last 15 minutes",
    test: async (folder) => {
      const { mine, reference } = await run(folder);
      return !!mine.rows[0] && mine.rows[0].trace_id === reference[0]?.trace_id;
    },
    tryNext:
      "in the inner SELECT, add ORDER BY Duration DESC before LIMIT 1; " +
      "DESC puts the slowest first",
  },
  {
    says: "it lists every span of that trace",
    test: async (folder) => {
      const { mine, reference } = await run(folder);
      return spanNames(mine.rows) === spanNames(reference);
    },
    tryNext: "select every span of the trace, with no filter on SpanName, and ORDER BY Timestamp",
  },
  {
    says: "it shows the slow span: INSERT audit_trail, over 1 second",
    test: async (folder) => {
      const auditTrail = (await myRows(folder)).find((row) => row.span === "INSERT audit_trail");
      return !!auditTrail && Number(auditTrail.duration_ms) > 1000;
    },
    tryNext: "write the duration in milliseconds: Duration is in nanoseconds, so divide by 1e6",
  },
] satisfies Rule[];
