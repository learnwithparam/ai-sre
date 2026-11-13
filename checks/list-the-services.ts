// list-the-services: the learner's SQL runs against a recorded morning at Gullrock (or the live
// world), and its rows are compared with the reference query's rows.
import type { Rule } from "../scripts/verify";
import { read } from "./lib/files";
import { query, sourceFor } from "./lib/world";

const FILE = "list-the-services.sql";
const REFERENCE =
  "SELECT ServiceName AS service, count() AS spans, " +
  "countIf(StatusCode = 'Error') AS error_spans\n" +
  "FROM otel_traces WHERE Timestamp > now() - INTERVAL 60 MINUTE " +
  "GROUP BY service ORDER BY spans DESC";

// The column names are the ones the step asks the learner to write.
// biome-ignore lint/style/useNamingConvention: error_spans is a SQL column name.
type Row = { service: string; spans: number; error_spans: number };
type Run = { mine: Row[]; reference: Row[]; error: string };

// Runs the learner's query and the reference query once per folder, so every rule reads one run.
const runs = new Map<string, Promise<Run>>();

async function runBothQueries(folder: string): Promise<Run> {
  const sql = read(folder, FILE);
  const reference = await query<Row>(folder, REFERENCE);
  try {
    return { mine: await query<Row>(folder, sql), reference, error: "" };
  } catch (error) {
    return { mine: [], reference, error: (error as Error).message };
  }
}

function run(folder: string): Promise<Run> {
  let saved = runs.get(folder);
  if (!saved) {
    saved = runBothQueries(folder);
    runs.set(folder, saved);
  }
  return saved;
}

const isRead = (sql: string) => /^\s*(--[^\n]*\n\s*)*(select|with)\b/i.test(sql);

// Live traffic keeps arriving between the two queries, so live counts may differ by 2%.
function countsMatch(folder: string, mine: Row[], reference: Row[]): boolean {
  const slack = sourceFor(folder).kind === "live" ? 0.02 : 0;
  const near = (count: number, expected: number) =>
    Math.abs(count - expected) <= Math.ceil(expected * slack);
  return reference.every((expected) => {
    const found = mine.find((row) => row.service === expected.service);
    return (
      !!found &&
      near(Number(found.spans), Number(expected.spans)) &&
      near(Number(found.error_spans), Number(expected.error_spans))
    );
  });
}

export default [
  {
    says: `${FILE} holds one SELECT`,
    test: (folder) => isRead(read(folder, FILE)),
    tryNext: `write a SELECT in ${FILE}; it is the only statement in the file`,
  },
  {
    says: "the query runs",
    test: async (folder) => (await run(folder)).error === "",
    tryNext: "run the query in HyperDX's SQL view and fix the error it shows; then run this again",
  },
  {
    says: "it returns the columns service, spans and error_spans",
    test: async (folder) => {
      const firstRow = (await run(folder)).mine[0];
      const columns = ["service", "spans", "error_spans"];
      return !!firstRow && columns.every((column) => column in firstRow);
    },
    tryNext:
      "name the columns with AS: ServiceName AS service, count() AS spans, " +
      "and the error count AS error_spans",
  },
  {
    says: "one row per service that sent spans in the last 60 minutes",
    test: async (folder) => {
      const { mine, reference } = await run(folder);
      const services = new Set(mine.map((row) => row.service));
      return mine.length === reference.length && services.size === reference.length;
    },
    tryNext:
      "GROUP BY the service, and keep only spans from the last 60 minutes: " +
      "WHERE Timestamp > now() - INTERVAL 60 MINUTE",
  },
  {
    says: "the busiest service comes first",
    test: async (folder) => {
      const { mine, reference } = await run(folder);
      return mine[0]?.service === reference[0]?.service;
    },
    tryNext: "ORDER BY spans DESC, so the service with the most spans is the first row",
  },
  {
    says: "span and error counts match the telemetry",
    test: async (folder) => {
      const { mine, reference } = await run(folder);
      return countsMatch(folder, mine, reference);
    },
    tryNext:
      "count spans with count() and errors with countIf(StatusCode = 'Error'); " +
      "the value is case sensitive, so look at one row first",
  },
  {
    says: "it reads the world you are checking against",
    test: async (folder) =>
      sourceFor(folder).kind === "recorded" || (await run(folder)).reference.length > 0,
    tryNext:
      "start the world with bun run world and wait a minute for traffic, then run this again",
  },
] satisfies Rule[];
