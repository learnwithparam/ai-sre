// Is a run real? Its audit rows must be in the world's audit log: the live sre.incident_events,
// or the recording when the folder is checked against one.
import { join } from "node:path";
import { queryRecorded, RECORDINGS } from "../../checks/lib/recorded";
import { sourceFor } from "../../checks/lib/world";
import { chQuery, chReachable } from "../../world/lib/clickhouse";
import type { Run } from "./scorer";

const INCIDENT_ID = /^inc-[0-9a-f]{12}$/;

async function worldKinds(folder: string, incidentId: string): Promise<string[] | null> {
  const source = sourceFor(folder);
  const where = `WHERE incident_id = '${incidentId}' ORDER BY ts`;
  if (source.kind === "live") {
    if (!(await chReachable())) throw new Error("the world is not running: bun run world");
    const rows = await chQuery<{ kind: string }>(`SELECT kind FROM sre.incident_events ${where}`);
    return rows.map((row) => row.kind);
  }
  const path = join(RECORDINGS, source.name, "incident_events.native.zst");
  const sql = `SELECT kind FROM file('${path}', 'Native') ${where}`;
  const rows = await queryRecorded<{ kind: string }>(source.name, sql);
  return rows.map((row) => row.kind);
}

// A recording holds one scenario, so in a recorded folder only that scenario's runs can be
// looked up. The live world can look up every run.
export async function runIsInTheWorld(folder: string, run: Run): Promise<boolean> {
  if (!INCIDENT_ID.test(run.incident_id) || run.events.length === 0) return false;
  const source = sourceFor(folder);
  if (source.kind === "recorded" && run.case !== source.name) return true;
  const kinds = await worldKinds(folder, run.incident_id);
  const runKinds = run.events.map((event) => event.kind);
  return kinds !== null && runKinds.every((kind) => kinds.includes(kind));
}
