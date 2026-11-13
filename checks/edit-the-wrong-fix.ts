// edit-the-wrong-fix: on timetable-hang the AI SRE proposes rolling booking-web back. The
// learner rejects it, edits it to a restart of timetable-loader, approves, and runs it. The
// check reads the order of the rows in the audit log.
import {
  type AuditRow,
  currentPlan,
  happenedInOrder,
  incidentRows,
  isActionId,
  payloadOf,
  rightAction,
  rowsFor,
  samePlan,
} from "../parts/05-ask-before-you-act/audit";
import type { Rule } from "../scripts/verify";
import { field, read } from "./lib/files";

const FILE = "decision.md";
const right = rightAction("timetable-hang");
const ORDER = [
  "remediation_proposed",
  "remediation_rejected",
  "remediation_edited",
  "remediation_approved",
  "remediation_executed",
];

const actionId = (folder: string) => field(read(folder, FILE), "Action id");

async function actionRows(folder: string): Promise<AuditRow[]> {
  const rows = await rowsFor(folder, actionId(folder));
  return rows[0]?.kind === "remediation_proposed" ? rows : [];
}

// The decisions only. A refused attempt to run is not a decision, so it is left out.
function decisions(rows: AuditRow[]): string[] {
  return rows.map((row) => row.kind).filter((kind) => ORDER.includes(kind));
}

export default [
  {
    says: `${FILE} names a proposal for the timetable-hang incident`,
    test: async (folder) => {
      const rows = await actionRows(folder);
      if (!isActionId(actionId(folder)) || !rows[0]) return false;
      const incident = await incidentRows(folder, rows[0].incident_id);
      const opened = payloadOf(incident.find((row) => row.kind === "incident_opened"));
      return opened.rule === "stuck_requests";
    },
    tryNext:
      "run bun run world break timetable-hang, then the AI SRE, and copy the action id it " +
      `proposed into ${FILE}`,
  },
  {
    says: "the AI SRE first proposed the wrong fix: roll booking-web back",
    test: async (folder) => {
      const [proposed] = await actionRows(folder);
      return payloadOf(proposed).action === "rollback_release";
    },
    tryNext:
      "use the proposal from bun parts/05-ask-before-you-act/ai-sre.ts timetable-hang, " +
      "not one you sent yourself",
  },
  {
    says: "you rejected it, with a reason, before anything ran",
    test: async (folder) => {
      const rows = await actionRows(folder);
      const rejected = rows.find((row) => row.kind === "remediation_rejected");
      const reason = String(payloadOf(rejected).reason ?? "").trim();
      return reason !== "" && happenedInOrder(rows, ORDER.slice(0, 2));
    },
    tryNext: "on the approval page, write why in the reason box, then press Reject",
  },
  {
    says: "the order is proposed, rejected, edited, approved, executed",
    test: async (folder) =>
      JSON.stringify(decisions(await actionRows(folder))) === JSON.stringify(ORDER),
    tryNext:
      "after Reject, use Edit to change the action, then Approve, then run it once " +
      "with call-tool.ts execute_remediation",
  },
  {
    says: `the change that ran is ${right.action} ${right.target}`,
    test: async (folder) => samePlan(currentPlan(await actionRows(folder)), right),
    tryNext:
      "the hang is inside timetable-loader, so edit the action to restart_service " +
      "on timetable-loader",
  },
  {
    says: "timetable-loader is healthy again: verification_passed",
    test: async (folder) =>
      happenedInOrder(await actionRows(folder), ["remediation_executed", "verification_passed"]),
    tryNext: "wait about 90 seconds after the restart, then run this again",
  },
  {
    says: `${FILE} says why the first fix was wrong`,
    test: (folder) => field(read(folder, FILE), "Why I rejected").split(/\s+/).length >= 6,
    tryNext: "add a line Why I rejected: and one sentence about which service really hangs",
  },
] satisfies Rule[];
