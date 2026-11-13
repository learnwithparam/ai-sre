// The records a postmortem is built from: the audit log of one incident, the telemetry of the
// change that caused it, and the bookings in Postgres. The checks of this part read them here.
//
// A folder with recorded-world.txt reads the recording as it was captured, with its first
// clock times. Every other folder reads the live world on your machine.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { queryRecorded, RECORDINGS } from "../../checks/lib/recorded";
import { sourceFor } from "../../checks/lib/world";
import { chQuery, chReachable } from "../../world/lib/clickhouse";
import { ENV_PATH, ROOT } from "../../world/lib/env";

// biome-ignore-start lint/style/useNamingConvention: these are ClickHouse column names.
export type AuditRow = {
  ts: string;
  incident_id: string;
  action_id: string;
  kind: string;
  actor: string;
  payload: string;
};
// biome-ignore-end lint/style/useNamingConvention: these are ClickHouse column names.

export const INCIDENT_ID = /^inc-[0-9a-f]{12}$/;
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

// The table to read from: the live table, or the recorded file exactly as it was captured.
function tableFor(folder: string, table: "events" | "traces"): string {
  const source = sourceFor(folder);
  const liveName = table === "events" ? "sre.incident_events" : "otel_traces";
  if (source.kind === "live") return liveName;
  const fileName = table === "events" ? "incident_events" : "otel_traces";
  const path = join(RECORDINGS, source.name, `${fileName}.native.zst`);
  return `file('${path}', 'Native')`;
}

async function readRows<T>(folder: string, sql: string): Promise<T[]> {
  const source = sourceFor(folder);
  if (source.kind === "recorded") return queryRecorded<T>(source.name, sql);
  if (!(await chReachable())) throw new Error("the world is not running: bun run world");
  return chQuery<T>(sql);
}

// Every audit row of one incident, oldest first. ts reads like 2026-11-12 22:17:52.577 (UTC).
export async function auditRows(folder: string, incidentId: string): Promise<AuditRow[]> {
  if (!INCIDENT_ID.test(incidentId)) return [];
  const sql =
    "SELECT toString(ts) AS ts, incident_id, action_id, kind, actor, payload " +
    `FROM ${tableFor(folder, "events")} WHERE incident_id = '${incidentId}' ORDER BY ts`;
  return readRows<AuditRow>(folder, sql);
}

// The newest incidents, so you can find the one you want to write up.
export async function latestIncidents(folder: string, limit = 10): Promise<AuditRow[]> {
  const sql =
    "SELECT toString(ts) AS ts, incident_id, action_id, kind, actor, payload " +
    `FROM ${tableFor(folder, "events")} WHERE kind = 'incident_opened' ` +
    `ORDER BY ts DESC LIMIT ${limit}`;
  return readRows<AuditRow>(folder, sql);
}

// The clock time of a row, such as 22:17:52. Times in a postmortem are UTC.
export const clockOf = (timestamp: string) => timestamp.slice(11, 19);

export function payloadOf(row: AuditRow): Record<string, unknown> {
  try {
    return JSON.parse(row.payload);
  } catch {
    return {};
  }
}

// The change the stored finding blames, such as { service: "booking-web", release: "v2" }.
export function blamedChange(rows: AuditRow[]): { service: string; release: string } | null {
  const finding = rows.find((row) => row.kind === "finding_submitted");
  if (!finding) return null;
  const payload = payloadOf(finding) as { service?: string; change?: Record<string, string> };
  const change = payload.change ?? {};
  if (change.kind !== "release") return null;
  return { service: String(payload.service ?? ""), release: String(change.value ?? "") };
}

export type ImpactWindow = { start: string; end: string };

// The impact starts when the blamed release served its first span, at most 30 minutes before
// the page, and ends when the approved change ran.
export async function impactWindow(folder: string, rows: AuditRow[]): Promise<ImpactWindow | null> {
  const change = blamedChange(rows);
  const opened = rows.find((row) => row.kind === "incident_opened");
  const executed = rows.find((row) => row.kind === "remediation_executed");
  if (!change || !opened || !executed) return null;
  if (!SAFE_NAME.test(change.service) || !SAFE_NAME.test(change.release)) return null;
  const openedAt = `toDateTime64('${opened.ts}', 3, 'UTC')`;
  const sql =
    `SELECT toString(min(Timestamp)) AS first FROM ${tableFor(folder, "traces")} ` +
    `WHERE ServiceName = '${change.service}' ` +
    `AND ResourceAttributes['service.version'] = '${change.release}' ` +
    `AND Timestamp >= ${openedAt} - INTERVAL 30 MINUTE AND Timestamp <= ${openedAt}`;
  const [found] = await readRows<{ first: string }>(folder, sql);
  if (!found?.first || found.first.startsWith("1970")) return null;
  return { start: found.first.slice(0, 23), end: executed.ts };
}

// Booking requests that failed inside the window, counted from the traces.
export async function failedBookings(folder: string, window: ImpactWindow): Promise<number> {
  const sql =
    `SELECT count() AS failed FROM ${tableFor(folder, "traces")} ` +
    "WHERE ServiceName = 'booking-web' AND SpanName = 'POST /api/bookings' " +
    "AND StatusCode = 'Error' " +
    `AND Timestamp >= toDateTime64('${window.start}', 3, 'UTC') ` +
    `AND Timestamp <= toDateTime64('${window.end}', 3, 'UTC')`;
  const [row] = await readRows<{ failed: number }>(folder, sql);
  return Number(row?.failed ?? 0);
}

// 2026-11-12 22:17:52.577 becomes 2026-11-12T22:17:52.577Z, the way Postgres stores created_at.
const isoOf = (timestamp: string) => `${timestamp.replace(" ", "T")}Z`;

function liveBookingCount(window: ImpactWindow): number {
  const compose = ["docker", "compose", "-p", "gullrock", "--env-file", ENV_PATH];
  const composeFile = ["-f", join(ROOT, "world", "compose.yml")];
  const psql = ["exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "gullrock", "-At"];
  const sql =
    `SELECT count(*) FROM bookings WHERE created_at >= '${isoOf(window.start)}' ` +
    `AND created_at <= '${isoOf(window.end)}'`;
  const result = Bun.spawnSync([...compose, ...composeFile, ...psql, "-c", sql], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return Number(result.stdout.toString().trim() || "-1");
}

// Bookings that went through inside the window: rows in the Postgres bookings table.
export function confirmedBookings(folder: string, window: ImpactWindow): number {
  const source = sourceFor(folder);
  if (source.kind === "live") return liveBookingCount(window);
  const path = join(RECORDINGS, source.name, "bookings.json");
  // biome-ignore lint/style/useNamingConvention: created_at is the Postgres column name.
  type Booking = { created_at: string };
  const bookings: Booking[] = JSON.parse(readFileSync(path, "utf8"));
  const start = isoOf(window.start);
  const end = isoOf(window.end);
  const inside = bookings.filter((booking) => {
    return booking.created_at >= start && booking.created_at <= end;
  });
  return inside.length;
}
