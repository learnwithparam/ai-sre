// name-the-release: your SQL runs on the recorded bad-release morning. Split by release, the
// booking errors must point at one release: v2 fails about 1 booking in 5, v1 fails none.

import { type Answer, answerAtMoment, isOneSelect } from "../parts/03-look-without-touching/replay";
import type { Rule } from "../scripts/verify";
import { read } from "./lib/files";

const FILE = "name-the-release.sql";
const REFERENCE = `
SELECT
    ResourceAttributes['service.version'] AS release,
    count() AS requests,
    countIf(StatusCode = 'Error') AS errors
FROM otel_traces
WHERE ServiceName = 'booking-web' AND SpanKind = 'Server' AND SpanName = 'POST /api/bookings'
    AND Timestamp > now() - INTERVAL 15 MINUTE
GROUP BY release`;

// biome-ignore lint/style/useNamingConvention: error_rate is a SQL column name.
type Row = { release: string; requests: number; errors: number; error_rate: number };
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

async function rowFor(folder: string, release: string): Promise<Row | undefined> {
  return (await run(folder)).mine.rows.find((row) => row.release === release);
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
    says: "it returns release, requests, errors and error_rate",
    test: async (folder) => {
      const firstRow = (await run(folder)).mine.rows[0] ?? {};
      return ["release", "requests", "errors", "error_rate"].every((column) => column in firstRow);
    },
    tryNext:
      "name each column with AS, and compute errors / requests AS error_rate; " +
      "the release is ResourceAttributes['service.version'] AS release",
  },
  {
    says: "there is one row for each release, v1 and v2",
    test: async (folder) => {
      const releases = (await run(folder)).mine.rows.map((row) => row.release).sort();
      return releases.join(",") === "v1,v2";
    },
    tryNext:
      "GROUP BY release; the release lives in ResourceAttributes, not in SpanAttributes, " +
      "because the whole service shares it",
  },
  {
    says: "each release counts only its booking requests",
    test: async (folder) => {
      const { reference } = await run(folder);
      const checks = reference.map(async (expected) => {
        const found = await rowFor(folder, expected.release);
        return (
          Number(found?.requests) === Number(expected.requests) &&
          Number(found?.errors) === Number(expected.errors)
        );
      });
      return reference.length > 0 && (await Promise.all(checks)).every(Boolean);
    },
    tryNext: "keep only SpanKind = 'Server' AND SpanName = 'POST /api/bookings'",
  },
  {
    says: "release v2 fails more than 20% of bookings, and v1 fails under 1%",
    test: async (folder) => {
      const newRelease = await rowFor(folder, "v2");
      const oldRelease = await rowFor(folder, "v1");
      return Number(newRelease?.error_rate) > 0.2 && Number(oldRelease?.error_rate) < 0.01;
    },
    tryNext: "error_rate is errors / requests, a fraction between 0 and 1",
  },
  {
    says: "the worst release comes first",
    test: async (folder) => (await run(folder)).mine.rows[0]?.release === "v2",
    tryNext: "add ORDER BY error_rate DESC",
  },
] satisfies Rule[];
