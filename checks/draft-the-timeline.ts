// draft-the-timeline: every line of the postmortem timeline must be a row of harbour-control's
// audit log (sre.incident_events), at the same second and with the same event kind.
import { incidentIdIn, POSTMORTEM, timelineLines } from "../parts/06-write-it-down/postmortem";
import { type AuditRow, auditRows, clockOf, INCIDENT_ID } from "../parts/06-write-it-down/records";
import type { Rule } from "../scripts/verify";
import { read } from "./lib/files";

// The moments every timeline keeps, when the incident has them.
const KEY_MOMENTS = [
  "incident_opened",
  "finding_submitted",
  "remediation_approved",
  "remediation_executed",
  "incident_resolved",
];

// The audit rows are read once per folder, so every rule reads the same rows.
const saved = new Map<string, Promise<AuditRow[]>>();

function rowsFor(folder: string): Promise<AuditRow[]> {
  let rows = saved.get(folder);
  if (!rows) {
    rows = auditRows(folder, incidentIdIn(folder));
    saved.set(folder, rows);
  }
  return rows;
}

const lines = (folder: string) => timelineLines(read(folder, POSTMORTEM));

function hasRow(rows: AuditRow[], clock: string, kind: string): boolean {
  return rows.some((row) => clockOf(row.ts) === clock && row.kind === kind);
}

export default [
  {
    says: `${POSTMORTEM} names the incident on an "Incident:" line`,
    test: (folder) => INCIDENT_ID.test(incidentIdIn(folder)),
    tryNext:
      "add a line such as Incident: inc-b1182f037ed0; " +
      "bun parts/06-write-it-down/audit-log.ts lists your incidents",
  },
  {
    says: "the incident is in the audit log",
    test: async (folder) => {
      const rows = await rowsFor(folder);
      return rows.some((row) => row.kind === "incident_opened");
    },
    tryNext:
      "copy the id exactly from bun parts/06-write-it-down/audit-log.ts; " +
      "with no world running, see If you get stuck",
  },
  {
    says: "the Timeline section has at least five lines like - 22:17:52 incident_opened: ...",
    test: (folder) => lines(folder).length >= 5,
    tryNext:
      "under ## Timeline write one line per event: a dash, the UTC time, the event kind, " +
      "a colon, and what happened",
  },
  {
    says: "every timeline line matches an audit row: the same second and the same event",
    test: async (folder) => {
      const rows = await rowsFor(folder);
      const found = lines(folder);
      return found.length > 0 && found.every((line) => hasRow(rows, line.clock, line.kind));
    },
    tryNext:
      "copy each time from the audit log, in UTC, not your local clock; " +
      "delete any line that has no row, however sure you are it happened",
  },
  {
    says: "the timeline keeps the page, the finding, the approval, the change and the recovery",
    test: async (folder) => {
      const rows = await rowsFor(folder);
      const kinds = new Set(lines(folder).map((line) => line.kind));
      const present = KEY_MOMENTS.filter((kind) => rows.some((row) => row.kind === kind));
      return present.length > 0 && present.every((kind) => kinds.has(kind));
    },
    tryNext:
      "add a line for each of incident_opened, finding_submitted, remediation_approved, " +
      "remediation_executed and incident_resolved",
  },
  {
    says: "the lines are in time order",
    test: (folder) => {
      const clocks = lines(folder).map((line) => line.clock);
      const sorted = [...clocks].sort();
      return clocks.length > 0 && clocks.join() === sorted.join();
    },
    tryNext: "put the oldest event first and the recovery last, as the audit log does",
  },
] satisfies Rule[];
