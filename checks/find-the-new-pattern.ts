// find-the-new-pattern: your SQL runs on the recorded bad-release morning, played back to one
// minute after the first booking failed. The new error pattern must come out on top.

import {
  type Answer,
  answerAtMoment,
  isOneSelect,
  secondsBeforeEnd,
} from "../parts/03-look-without-touching/replay";
import type { Rule } from "../scripts/verify";
import { read } from "./lib/files";

const FILE = "find-the-new-pattern.sql";
const COLUMNS = ["pattern", "release", "incident_lines", "baseline_lines", "is_new"];
const REFERENCE = `
WITH
    replaceRegexpAll(
        replaceRegexpAll(
            replaceRegexpAll(Body, '[A-Z]{2}-[A-Z0-9]{6}', '<ref>'),
            '\\\\d+\\\\.\\\\d+\\\\.\\\\d+\\\\.\\\\d+',
            '<ip>'
        ),
        '\\\\d+',
        'N'
    ) AS pattern,
    now() - INTERVAL 1 MINUTE AS incident_start,
    incident_start - INTERVAL 1 MINUTE AS baseline_start
SELECT
    pattern,
    countIf(Timestamp >= incident_start) AS incident_lines
FROM otel_logs
WHERE ServiceName = 'booking-web' AND Timestamp >= baseline_start
GROUP BY pattern
HAVING countIf(Timestamp < incident_start) = 0 AND incident_lines > 0
ORDER BY incident_lines DESC
LIMIT 1`;

// The columns are SQL column names, so they keep their underscores.
type Column = "pattern" | "release" | "incident_lines" | "baseline_lines" | "is_new";
type Row = Record<Column, string>;
type Run = { mine: Answer<Row>; newest: Row | undefined };

const runs = new Map<string, Promise<Run>>();

async function runAtTheMoment(folder: string): Promise<Run> {
  const firstError = "SELECT minIf(Timestamp, StatusCode = 'Error') AS at FROM otel_traces";
  const oneMinuteLater = (await secondsBeforeEnd("bad-release", firstError)) - 60;
  const reference = await answerAtMoment<Row>("bad-release", oneMinuteLater, REFERENCE);
  const mine = await answerAtMoment<Row>("bad-release", oneMinuteLater, read(folder, FILE));
  return { mine, newest: reference.rows[0] };
}

function run(folder: string): Promise<Run> {
  let saved = runs.get(folder);
  if (!saved) {
    saved = runAtTheMoment(folder);
    runs.set(folder, saved);
  }
  return saved;
}

const topRow = async (folder: string) => (await run(folder)).mine.rows[0];
const isTrue = (value: unknown) => value === true || Number(value) === 1;

export default [
  {
    says: `${FILE} holds one SELECT`,
    test: (folder) => isOneSelect(read(folder, FILE)),
    tryNext: `keep one SELECT in ${FILE}; the WITH part at the top belongs to it`,
  },
  {
    says: "the query runs on the recorded bad-release morning",
    test: async (folder) => (await run(folder)).mine.error === "",
    tryNext: "run the query in HyperDX's SQL view and fix the error it shows; then run this again",
  },
  {
    says: "it returns pattern, release, incident_lines, baseline_lines and is_new",
    test: async (folder) => {
      const firstRow = (await topRow(folder)) ?? {};
      return COLUMNS.every((column) => column in firstRow);
    },
    tryNext:
      "count each window with countIf: countIf(Timestamp >= incident_start) AS incident_lines, " +
      "and countIf(Timestamp < incident_start) AS baseline_lines",
  },
  {
    says: "each row is a pattern: booking references are masked",
    test: async (folder) => {
      const rows = (await run(folder)).mine.rows;
      return rows.length > 0 && rows.every((row) => !/GR-[A-Z0-9]{6}/.test(String(row.pattern)));
    },
    tryNext: "group by the masked pattern from the WITH part, not by Body",
  },
  {
    says: "the access log line is not new: it was there in the baseline too",
    test: async (folder) => {
      const rows = (await run(folder)).mine.rows;
      const accessLog = rows.find((row) => String(row.pattern).includes('"GET /"'));
      return !!accessLog && !isTrue(accessLog.is_new) && Number(accessLog.baseline_lines) > 0;
    },
    tryNext:
      "read the baseline minute too: WHERE Timestamp >= baseline_start, and " +
      "is_new is baseline_lines = 0 AND incident_lines > 0",
  },
  {
    says: "the top row is the new connection pool error",
    test: async (folder) => String((await topRow(folder))?.pattern).includes("connection pool"),
    tryNext: "ORDER BY is_new DESC, incident_lines DESC, so new patterns come first",
  },
  {
    says: "the top row is new, it comes from release v2, and its counts match the telemetry",
    test: async (folder) => {
      const { mine, newest } = await run(folder);
      const top = mine.rows[0];
      return (
        !!top &&
        !!newest &&
        isTrue(top.is_new) &&
        top.release === "v2" &&
        Number(top.baseline_lines) === 0 &&
        Number(top.incident_lines) === Number(newest.incident_lines)
      );
    },
    tryNext:
      "take the release of the newest line: " +
      "argMax(ResourceAttributes['service.version'], Timestamp) AS release",
  },
] satisfies Rule[];
