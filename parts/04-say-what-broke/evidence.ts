// What the say-what-broke checks read: the findings harbour-control stored in its audit log,
// the telemetry behind them, and the fault the course planted. A folder with recorded-world.txt
// reads a recording; any other folder reads the live world.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RECORDINGS } from "../../checks/lib/recorded";
import { query, sourceFor } from "../../checks/lib/world";
import { ROOT } from "../../world/lib/env";

// The fields of a finding, as harbour-control stores them and as the learner's file holds them.
// biome-ignore-start lint/style/useNamingConvention: harbour-control names these fields.
export type Finding = {
  finding_id?: string;
  incident_id?: string;
  service?: string;
  change?: { kind?: string; value?: string };
  pattern?: string;
  quote?: string;
  trace_ids?: string[];
  hypothesis?: string;
  ruled_out?: { signal?: string; why?: string }[];
  reason?: string;
};
export type AuditRow = { incident_id: string; action_id: string; kind: string; payload: string };
// biome-ignore-end lint/style/useNamingConvention: harbour-control names these fields.

export type Planted = {
  service: string;
  change: { kind: string; value: string };
  pattern: string[];
};

const TRACE_ID = /^[0-9a-f]{32}$/;
const FINDING_ID = /^fnd-[0-9a-f]{12}$/;

// A missing or broken file reads as an empty finding, so each rule fails with its own advice.
export function readFinding(folder: string, fileName: string): Finding {
  const path = join(folder, fileName);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export function hasFindingId(finding: Finding): boolean {
  return FINDING_ID.test(finding.finding_id ?? "");
}

export function plantedFault(scenario: string): Planted {
  const path = join(ROOT, "world", "scenarios", `${scenario}.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

// The verification code of the planted fault. A recording keeps it in its own scenario.json;
// the live world keeps it in world/.state/scenario.json while the fault is planted.
export function plantedCode(folder: string, scenario: string): string {
  const source = sourceFor(folder);
  const path =
    source.kind === "recorded"
      ? join(RECORDINGS, source.name, "scenario.json")
      : join(ROOT, "world", ".state", "scenario.json");
  if (!existsSync(path)) return "";
  const state = JSON.parse(readFileSync(path, "utf8"));
  return state.scenario === scenario ? state.code : "";
}

export async function auditRows(folder: string, actionId: string): Promise<AuditRow[]> {
  const sql =
    "SELECT incident_id, action_id, kind, payload FROM sre.incident_events " +
    "WHERE action_id = {id:String} ORDER BY ts";
  return query<AuditRow>(folder, sql, { id: actionId });
}

// The finding harbour-control stored under this id, or null when it stored none.
export async function storedFinding(folder: string, findingId: string): Promise<Finding | null> {
  const rows = await auditRows(folder, findingId);
  const submitted = rows.find((row) => row.kind === "finding_submitted");
  if (!submitted) return null;
  const finding: Finding = JSON.parse(submitted.payload);
  finding.finding_id = findingId;
  finding.incident_id = submitted.incident_id;
  return finding;
}

export async function incidentRows(folder: string, incidentId: string): Promise<AuditRow[]> {
  const sql =
    "SELECT incident_id, action_id, kind, payload FROM sre.incident_events " +
    "WHERE incident_id = {id:String} ORDER BY ts";
  return query<AuditRow>(folder, sql, { id: incidentId });
}

// Trace ids go into SQL as text, so only real 32 character hex ids are let through.
export function traceIdList(traceIds: string[] = []): string {
  const safe = traceIds.filter((traceId) => TRACE_ID.test(traceId));
  return safe.map((traceId) => `'${traceId}'`).join(", ") || "''";
}

// Which of these trace ids have any span or log line in the telemetry.
export async function tracesThatExist(folder: string, traceIds: string[]): Promise<string[]> {
  const list = traceIdList(traceIds);
  const sql =
    `SELECT DISTINCT TraceId AS id FROM otel_traces WHERE TraceId IN (${list}) ` +
    `UNION DISTINCT SELECT DISTINCT TraceId AS id FROM otel_logs WHERE TraceId IN (${list})`;
  const rows = await query<{ id: string }>(folder, sql);
  return rows.map((row) => row.id);
}

export function sameList(first: string[] = [], second: string[] = []): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}
