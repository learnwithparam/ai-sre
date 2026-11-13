// Plays a recording back as if the clock stood at an earlier moment. The checks use it to ask
// "would your rule page here?" at many moments in a row.
// Your SQL says now(). Here now() is one fixed instant, and the recording is moved so that the
// chosen moment falls on it. Every row after that moment is hidden. A fixed now() means the
// 10 second buckets fall on the same rows in every run, so a check gives the same answer twice.
import { join, relative } from "node:path";
import { queryRecorded, RECORDINGS } from "../../checks/lib/recorded";

const PART_RECORDINGS = join(import.meta.dir, "recordings");

// Each recorded table, and the column that holds its time.
const TABLES = [
  { table: "default.otel_traces", timeColumn: "Timestamp" },
  { table: "default.otel_logs", timeColumn: "Timestamp" },
  { table: "sre.incident_events", timeColumn: "ts" },
];

// bad-release lives in world/recordings; noisy-morning is kept in this part's folder.
export function recordingName(name: string): string {
  if (name === "bad-release") return name;
  return relative(RECORDINGS, join(PART_RECORDINGS, name));
}

async function run(recording: string, sql: string) {
  return queryRecorded(recordingName(recording), sql);
}

// The fixed instant that now() means during a replay, in milliseconds since 1970. It reads as
// 08:30:00, so a replayed morning looks like a morning.
const FROZEN_NOW_MS = 1_893_486_600_000;
const FROZEN_NOW = `fromUnixTimestamp64Milli(${FROZEN_NOW_MS})`;

// The last moment in the recording, in milliseconds since 1970.
async function recordingEnd(recording: string): Promise<number> {
  const lastMoments = TABLES.map(
    ({ table, timeColumn }) => `(SELECT toUnixTimestamp64Milli(max(${timeColumn})) FROM ${table})`,
  );
  const [row] = await run(recording, `SELECT greatest(${lastMoments.join(", ")}) AS ms`);
  return Number(row.ms);
}

// How many seconds before the end of the recording the first row of sql happened. The sql
// returns one column called at.
export async function secondsBeforeEnd(recording: string, sql: string): Promise<number> {
  const end = await recordingEnd(recording);
  const [row] = await run(recording, `SELECT toUnixTimestamp64Milli(at) AS ms FROM (${sql})`);
  if (!row) return Number.NaN;
  return (end - Number(row.ms)) / 1000;
}

// The moments a replay looks at: one every 30 seconds, from one minute after the recording
// starts to its end. Each moment is a number of seconds before the end.
export async function replayMoments(recording: string): Promise<number[]> {
  const start = await secondsBeforeEnd(recording, "SELECT min(Timestamp) AS at FROM otel_traces");
  const moments: number[] = [];
  for (let moment = Math.floor(start) - 60; moment >= 0; moment -= 30) moments.push(moment);
  return moments;
}

async function moveTheClock(recording: string, secondsBeforeEnd: number) {
  const theMoment = (await recordingEnd(recording)) - Math.round(secondsBeforeEnd * 1000);
  const shift = `toIntervalMillisecond(${FROZEN_NOW_MS - theMoment})`;
  for (const { table, timeColumn } of TABLES) {
    await run(recording, `RENAME TABLE ${table} TO ${table}_whole`);
    const moved = `${timeColumn} + ${shift} AS ${timeColumn}`;
    // The filter runs first, in its own SELECT, so it reads the recorded time, not the moved one.
    const untilTheMoment = `${timeColumn} <= fromUnixTimestamp64Milli(${theMoment})`;
    const rowsUntilTheMoment = `SELECT * FROM ${table}_whole WHERE ${untilTheMoment}`;
    await run(
      recording,
      `CREATE VIEW ${table} AS SELECT * REPLACE (${moved}) FROM (${rowsUntilTheMoment})`,
    );
  }
}

// Every now() in your SQL becomes the fixed instant.
function withFrozenNow(sql: string): string {
  return sql.replace(/\bnow\(\s*\)/gi, FROZEN_NOW);
}

async function putTheClockBack(recording: string) {
  for (const { table } of TABLES) {
    await run(recording, `DROP VIEW IF EXISTS ${table}`);
    await run(recording, `RENAME TABLE ${table}_whole TO ${table}`);
  }
}

// Runs sql as if now() were secondsBeforeEnd seconds before the recording ends.
export async function queryAtMoment<Row = Record<string, unknown>>(
  recording: string,
  secondsBeforeEnd: number,
  sql: string,
): Promise<Row[]> {
  await moveTheClock(recording, secondsBeforeEnd);
  try {
    return (await run(recording, withFrozenNow(sql))) as Row[];
  } finally {
    await putTheClockBack(recording);
  }
}

export type Answer<Row> = { rows: Row[]; error: string };

// Like queryAtMoment, but a broken query becomes an error message instead of a crash.
export async function answerAtMoment<Row = Record<string, unknown>>(
  recording: string,
  secondsBeforeEnd: number,
  sql: string,
): Promise<Answer<Row>> {
  try {
    return { rows: await queryAtMoment<Row>(recording, secondsBeforeEnd, sql), error: "" };
  } catch (error) {
    return { rows: [], error: (error as Error).message };
  }
}

// True when the file holds one read query: a SELECT, or a WITH that ends in a SELECT.
export function isOneSelect(sql: string): boolean {
  const withoutComments = sql.replace(/--[^\n]*/g, "").trim();
  const statements = withoutComments.split(";").filter((part) => part.trim() !== "");
  return statements.length === 1 && /^(select|with)\b/i.test(withoutComments);
}

export type Moment = { secondsBeforeEnd: number; row: Record<string, unknown>; error: string };

// Runs a rule at every replay moment of a recording. A rule returns one row.
export async function replayRule(recording: string, sql: string): Promise<Moment[]> {
  const timeline: Moment[] = [];
  for (const moment of await replayMoments(recording)) {
    const answer = await answerAtMoment(recording, moment, sql);
    timeline.push({ secondsBeforeEnd: moment, row: answer.rows[0] ?? {}, error: answer.error });
  }
  return timeline;
}

// A rule pages when its page column is true. Some rules call that column anomalous.
export function isPaging(moment: Moment, column: string): boolean {
  const value = moment.row[column];
  return value === true || Number(value) === 1;
}

// One page is a run of paging moments. A page that stays on is still one page.
export function countPages(timeline: Moment[], column: string): number {
  let pages = 0;
  let pagingBefore = false;
  for (const moment of timeline) {
    const paging = isPaging(moment, column);
    if (paging && !pagingBefore) pages += 1;
    pagingBefore = paging;
  }
  return pages;
}
