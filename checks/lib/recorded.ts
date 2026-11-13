// A recording played back in embedded ClickHouse (chdb), so SQL checks run with no Docker and no network.
// Timestamps are moved so the recording ends now: a query over "the last 15 minutes" still finds rows.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../../world/lib/env";

export const RECORDINGS = join(ROOT, "world", "recordings");
let session: any = null;
let loaded = "";

const TABLES: [string, string, string][] = [
  ["default", "otel_traces", "Timestamp"],
  ["default", "otel_logs", "Timestamp"],
  ["sre", "incident_events", "ts"],
];

async function open(name: string) {
  if (loaded === name) return session;
  const { Session } = await import("chdb");
  session?.close?.();
  session = new Session(mkdtempSync(join(tmpdir(), "gullrock-recorded-")));
  const dir = join(RECORDINGS, name);
  if (!existsSync(dir)) throw new Error(`there is no recording called ${name}`);
  const ends: number[] = [];
  for (const [db, table, ts] of TABLES) {
    const path = join(dir, `${table}.native.zst`);
    session.query(`CREATE DATABASE IF NOT EXISTS ${db}`);
    session.query(
      `CREATE TABLE ${db}.${table}_raw ENGINE = MergeTree ORDER BY tuple() AS SELECT * FROM file('${path}', 'Native')`,
    );
    const end = Number(
      JSON.parse(
        session.query(
          `SELECT toUnixTimestamp64Milli(max(${ts})) AS m FROM ${db}.${table}_raw`,
          "JSONEachRow",
        ),
      ).m,
    );
    if (end) ends.push(end);
  }
  const shiftMs = Date.now() - Math.max(...ends);
  for (const [db, table, ts] of TABLES) {
    session.query(`CREATE TABLE ${db}.${table} ENGINE = MergeTree ORDER BY tuple() AS
      SELECT * REPLACE (${ts} + toIntervalMillisecond(${shiftMs}) AS ${ts}) FROM ${db}.${table}_raw`);
    session.query(`DROP TABLE ${db}.${table}_raw`);
  }
  loaded = name;
  return session;
}

export async function queryRecorded<T = Record<string, unknown>>(
  name: string,
  sql: string,
): Promise<T[]> {
  const s = await open(name);
  const text: string = s.query(sql.trim().replace(/;\s*$/, ""), "JSONEachRow");
  return text.trim()
    ? text
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))
    : [];
}

export function recordedBookings(name: string): Record<string, unknown>[] {
  return JSON.parse(readFileSync(join(RECORDINGS, name, "bookings.json"), "utf8"));
}
