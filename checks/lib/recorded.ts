// A recording played back in embedded ClickHouse (chdb), so SQL checks run with no Docker and no
// network. Timestamps are moved so the recording ends now: "the last 15 minutes" still finds rows.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "chdb";
import { ROOT } from "../../world/lib/env";

export const RECORDINGS = join(ROOT, "world", "recordings");
let session: Session | null = null;
let loaded = "";

// Each recorded table: its database, its name, and its timestamp column.
const TABLES: [string, string, string][] = [
  ["default", "otel_traces", "Timestamp"],
  ["default", "otel_logs", "Timestamp"],
  ["sre", "incident_events", "ts"],
];

// Load one recorded table as <table>_raw and return its last timestamp in milliseconds.
function loadRawTable(chdb: Session, folder: string, table: [string, string, string]): number {
  const [database, name, timeColumn] = table;
  const path = join(folder, `${name}.native.zst`);
  chdb.query(`CREATE DATABASE IF NOT EXISTS ${database}`);
  chdb.query(
    `CREATE TABLE ${database}.${name}_raw ENGINE = MergeTree ORDER BY tuple() ` +
      `AS SELECT * FROM file('${path}', 'Native')`,
  );
  const lastRow = chdb.query(
    `SELECT toUnixTimestamp64Milli(max(${timeColumn})) AS m FROM ${database}.${name}_raw`,
    "JSONEachRow",
  );
  return Number(JSON.parse(lastRow).m);
}

// Copy <table>_raw into <table> with every timestamp moved forward by shiftMs.
function shiftTable(chdb: Session, table: [string, string, string], shiftMs: number): void {
  const [database, name, timeColumn] = table;
  const shifted = `${timeColumn} + toIntervalMillisecond(${shiftMs}) AS ${timeColumn}`;
  chdb.query(`CREATE TABLE ${database}.${name} ENGINE = MergeTree ORDER BY tuple() AS
      SELECT * REPLACE (${shifted}) FROM ${database}.${name}_raw`);
  chdb.query(`DROP TABLE ${database}.${name}_raw`);
}

async function open(name: string): Promise<Session> {
  if (session && loaded === name) return session;
  const chdb = await import("chdb");
  session?.close?.();
  const opened = new chdb.Session(mkdtempSync(join(tmpdir(), "gullrock-recorded-")));
  session = opened;
  const folder = join(RECORDINGS, name);
  if (!existsSync(folder)) throw new Error(`there is no recording called ${name}`);
  const ends: number[] = [];
  for (const table of TABLES) {
    const end = loadRawTable(opened, folder, table);
    if (end) ends.push(end);
  }
  const shiftMs = Date.now() - Math.max(...ends);
  for (const table of TABLES) shiftTable(opened, table, shiftMs);
  loaded = name;
  return opened;
}

export async function queryRecorded<T = Record<string, unknown>>(
  name: string,
  sql: string,
): Promise<T[]> {
  const chdb = await open(name);
  const statement = sql.trim().replace(/;\s*$/, "");
  const text = chdb.query(statement, "JSONEachRow").trim();
  if (!text) return [];
  return text.split("\n").map((line) => JSON.parse(line));
}

export function recordedBookings(name: string): Record<string, unknown>[] {
  return JSON.parse(readFileSync(join(RECORDINGS, name, "bookings.json"), "utf8"));
}
