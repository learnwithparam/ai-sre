// chart-the-error-rate: your SQL runs on the recorded bad-release morning, and its buckets are
// compared with the reference query's buckets, one by one.

import {
  type Answer,
  answerAtMoment,
  isOneSelect,
} from "../parts/02-know-when-it-is-broken/replay";
import type { Rule } from "../scripts/verify";
import { read } from "./lib/files";

const FILE = "chart-the-error-rate.sql";
const RECORDING = "bad-release";
const REFERENCE = `
SELECT
    toStartOfInterval(Timestamp, INTERVAL 10 SECOND) AS bucket,
    count() AS requests,
    countIf(StatusCode = 'Error') AS errors,
    errors / requests AS error_rate
FROM otel_traces
WHERE ServiceName = 'booking-web'
    AND SpanKind = 'Server'
    AND SpanName != 'GET /health'
    AND Timestamp > now() - INTERVAL 15 MINUTE
GROUP BY bucket
ORDER BY bucket`;

// biome-ignore lint/style/useNamingConvention: error_rate is a SQL column name.
type Row = { bucket: string; requests: number; errors: number; error_rate: number };
type Run = { mine: Answer<Row>; reference: Row[] };

// Runs both queries once per folder, so every rule reads the same run.
const runs = new Map<string, Promise<Run>>();

async function runBothQueries(folder: string): Promise<Run> {
  const reference = await answerAtMoment<Row>(RECORDING, 0, REFERENCE);
  const mine = await answerAtMoment<Row>(RECORDING, 0, read(folder, FILE));
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

// True when every reference bucket has a bucket in your rows with the same value in column.
async function sameInEveryBucket(folder: string, column: "requests" | "errors") {
  const { mine, reference } = await run(folder);
  if (mine.rows.length !== reference.length) return false;
  return reference.every((expected, index) => {
    const found = mine.rows[index];
    return found.bucket === expected.bucket && Number(found[column]) === Number(expected[column]);
  });
}

export default [
  {
    says: `${FILE} holds one SELECT`,
    test: (folder) => isOneSelect(read(folder, FILE)),
    tryNext: `write one SELECT in ${FILE}; it is the only statement in the file`,
  },
  {
    says: "the query runs on the recorded bad-release morning",
    test: async (folder) => (await run(folder)).mine.error === "",
    tryNext: "run the query in HyperDX's SQL view and fix the error it shows; then run this again",
  },
  {
    says: "it returns the columns bucket, requests, errors and error_rate",
    test: async (folder) => {
      const firstRow = (await myRows(folder))[0];
      const columns = ["bucket", "requests", "errors", "error_rate"];
      return !!firstRow && columns.every((column) => column in firstRow);
    },
    tryNext:
      "name each column with AS: the 10 second bucket AS bucket, count() AS requests, " +
      "the failed ones AS errors, and errors / requests AS error_rate",
  },
  {
    says: "every error_rate is a fraction between 0 and 1",
    test: async (folder) => {
      const rows = await myRows(folder);
      const rates = rows.map((row) => Number(row.error_rate));
      return rows.length > 0 && rates.every((rate) => rate >= 0 && rate <= 1);
    },
    tryNext: "divide errors by requests and do not multiply by 100; 0.05 means 5%",
  },
  {
    says: "each bucket counts booking-web requests only, without health checks",
    test: (folder) => sameInEveryBucket(folder, "requests"),
    tryNext:
      "keep only ServiceName = 'booking-web' AND SpanKind = 'Server' " +
      "AND SpanName != 'GET /health', in 10 second buckets over the last 15 minutes",
  },
  {
    says: "each bucket counts the failed requests",
    test: (folder) => sameInEveryBucket(folder, "errors"),
    tryNext:
      "count failed requests with countIf(StatusCode = 'Error'); the value is case sensitive",
  },
  {
    says: "the oldest bucket comes first",
    test: async (folder) => {
      const buckets = (await myRows(folder)).map((row) => row.bucket);
      const sorted = [...buckets].sort();
      return buckets.length > 1 && buckets.every((bucket, index) => bucket === sorted[index]);
    },
    tryNext: "add ORDER BY bucket, so the chart reads from left to right",
  },
] satisfies Rule[];
