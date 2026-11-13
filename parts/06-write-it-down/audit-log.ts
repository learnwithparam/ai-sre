// bun parts/06-write-it-down/audit-log.ts                       the newest incidents
// bun parts/06-write-it-down/audit-log.ts <incident-id>         its audit rows and its impact
// Add --recorded to read the recorded bad-release morning instead of your live world.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AuditRow,
  auditRows,
  clockOf,
  confirmedBookings,
  failedBookings,
  impactWindow,
  latestIncidents,
  payloadOf,
} from "./records";

const say = (line: string) => console.log(line);

// The records helpers read the world a folder points at, so make a folder that points at
// the recording.
function folderToRead(recorded: boolean): string {
  const folder = mkdtempSync(join(tmpdir(), "gullrock-audit-"));
  if (recorded) writeFileSync(join(folder, "recorded-world.txt"), "bad-release\n");
  return folder;
}

// One short sentence from the row's payload, so each line says what happened.
function whatHappened(row: AuditRow): string {
  const payload = payloadOf(row);
  const words = [payload.summary, payload.hypothesis, payload.note, payload.reason];
  const sentence = words.find((value) => typeof value === "string");
  if (sentence) return String(sentence);
  if (payload.action) return `${payload.action} ${payload.target ?? ""}`.trim();
  return "";
}

function printRow(row: AuditRow): void {
  const kind = row.kind.padEnd(22);
  const actor = row.actor.padEnd(22);
  say(`  ${clockOf(row.ts)}  ${kind}${actor}${whatHappened(row).slice(0, 90)}`);
}

async function printIncidents(folder: string): Promise<void> {
  const incidents = await latestIncidents(folder);
  if (incidents.length === 0) say("No incidents yet. Run bun run demo bad-release first.");
  else say("The newest incidents (times are UTC):");
  for (const row of incidents) {
    say(`  ${row.incident_id}  ${clockOf(row.ts)}  ${whatHappened(row).slice(0, 70)}`);
  }
}

async function printImpact(folder: string, rows: AuditRow[]): Promise<void> {
  const window = await impactWindow(folder, rows);
  if (!window) {
    say("\nNo impact window: this incident has no release finding and no executed change.");
    return;
  }
  say(`\nImpact window: ${clockOf(window.start)} to ${clockOf(window.end)}`);
  say("  It starts when the blamed release served its first span.");
  say("  It ends when the approved change ran.");
  say(`  Failed bookings: ${await failedBookings(folder, window)} (from the traces)`);
  say(`  Bookings confirmed: ${confirmedBookings(folder, window)} (from the bookings table)`);
}

async function printIncident(folder: string, incidentId: string): Promise<void> {
  const rows = await auditRows(folder, incidentId);
  if (rows.length === 0) {
    say(`There are no audit rows for "${incidentId}". Run this with no id to list incidents.`);
    process.exit(1);
  }
  say(`Incident ${incidentId}: ${rows.length} audit rows (times are UTC)`);
  for (const row of rows) printRow(row);
  await printImpact(folder, rows);
}

const words = process.argv.slice(2);
const recorded = words.includes("--recorded");
const incidentId = words.find((word) => word.startsWith("inc-"));
const folder = folderToRead(recorded);
try {
  if (incidentId) await printIncident(folder, incidentId);
  else await printIncidents(folder);
} catch (error) {
  say(`Could not read the audit log: ${(error as Error).message}`);
  process.exit(2);
}
