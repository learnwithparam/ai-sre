// What the ask-before-you-act checks read: harbour-control's audit log for one proposed change,
// the finding it rests on, and the fixed list of actions. A folder with recorded-world.txt
// reads a recording; any other folder reads the live world.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "../../checks/lib/world";
import { ROOT } from "../../world/lib/env";

// biome-ignore-start lint/style/useNamingConvention: harbour-control names these fields.
export type AuditRow = {
  ts: string;
  incident_id: string;
  action_id: string;
  kind: string;
  actor: string;
  payload: string;
};
export type Proposal = {
  incident_id?: string;
  finding_id?: string;
  action?: string;
  target?: string;
  params?: Record<string, string>;
  action_id?: string;
};
// biome-ignore-end lint/style/useNamingConvention: harbour-control names these fields.

const ACTION_ID = /^act-[0-9a-f]{12}$/;
const COLUMNS = "toString(ts) AS ts, incident_id, action_id, kind, actor, payload";

export function readJson(folder: string, fileName: string): Proposal {
  const path = join(folder, fileName);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export function isActionId(text: string | undefined): boolean {
  return ACTION_ID.test(text ?? "");
}

export async function rowsFor(folder: string, actionId: string): Promise<AuditRow[]> {
  if (!isActionId(actionId)) return [];
  const sql = `SELECT ${COLUMNS} FROM sre.incident_events WHERE action_id = {id:String} ORDER BY ts`;
  return query<AuditRow>(folder, sql, { id: actionId });
}

export async function incidentRows(folder: string, incidentId: string): Promise<AuditRow[]> {
  const sql = `SELECT ${COLUMNS} FROM sre.incident_events WHERE incident_id = {id:String} ORDER BY ts`;
  return query<AuditRow>(folder, sql, { id: incidentId });
}

export function payloadOf(row: AuditRow | undefined): Record<string, unknown> {
  if (!row) return {};
  return JSON.parse(row.payload);
}

// The proposal as harbour-control stored it, with any edit applied on top.
export function currentPlan(rows: AuditRow[]): Proposal {
  let plan: Proposal = {};
  for (const row of rows) {
    if (row.kind === "remediation_proposed" || row.kind === "remediation_edited") {
      plan = { ...plan, ...payloadOf(row) };
    }
  }
  return plan;
}

export function firstTime(rows: AuditRow[], kind: string): string {
  return rows.find((row) => row.kind === kind)?.ts ?? "";
}

// True when every kind in the list happened, each one later than the one before.
export function happenedInOrder(rows: AuditRow[], kinds: string[]): boolean {
  let position = -1;
  for (const kind of kinds) {
    const next = rows.findIndex((row, index) => index > position && row.kind === kind);
    if (next < 0) return false;
    position = next;
  }
  return true;
}

export function rightAction(scenario: string): Proposal {
  const path = join(ROOT, "world", "scenarios", `${scenario}.json`);
  return JSON.parse(readFileSync(path, "utf8")).right_action;
}

export function samePlan(first: Proposal, second: Proposal): boolean {
  const sameParams = JSON.stringify(first.params ?? {}) === JSON.stringify(second.params ?? {});
  return first.action === second.action && first.target === second.target && sameParams;
}

// The blast radius text the approval page shows for one action, read from the live policy.
export function blastRadiusText(action: string): string {
  const policyPath = join(ROOT, "world", "harbour-control", "harbour_control", "policy.py");
  const policy = readFileSync(policyPath, "utf8");
  const block = policy.split("BLAST_RADIUS")[1] ?? "";
  const entry = block.split(`"${action}": (`)[1]?.split("),")[0] ?? "";
  const pieces = [...entry.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
  return pieces.join("");
}

const wordsOf = (text: string) => text.toLowerCase().match(/[a-z0-9']+/g) ?? [];

// True when the copy holds at least `length` words in a row from the original.
export function sharesWords(copy: string, original: string, length: number): boolean {
  const copied = ` ${wordsOf(copy).join(" ")} `;
  const words = wordsOf(original);
  for (let start = 0; start + length <= words.length; start++) {
    const run = words.slice(start, start + length).join(" ");
    if (copied.includes(` ${run} `)) return true;
  }
  return false;
}
