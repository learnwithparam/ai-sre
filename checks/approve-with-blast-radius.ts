// approve-with-blast-radius: the learner, as the on-call human, reads the evidence and the
// blast radius on the approval page and approves. The check reads the audit log and the
// learner's notes in approval.md.
import {
  type AuditRow,
  blastRadiusText,
  currentPlan,
  firstTime,
  incidentRows,
  isActionId,
  payloadOf,
  rowsFor,
  sharesWords,
} from "../parts/05-ask-before-you-act/audit";
import type { Rule } from "../scripts/verify";
import { field, read } from "./lib/files";

const FILE = "approval.md";
const actionId = (folder: string) => field(read(folder, FILE), "Action id");

async function actionRows(folder: string): Promise<AuditRow[]> {
  const rows = await rowsFor(folder, actionId(folder));
  return rows[0]?.kind === "remediation_proposed" ? rows : [];
}

function approval(rows: AuditRow[]): AuditRow | undefined {
  return rows.find((row) => row.kind === "remediation_approved");
}

// The trace ids of the finding this proposal rests on.
async function findingTraceIds(folder: string, rows: AuditRow[]): Promise<string[]> {
  const findingId = String(payloadOf(rows[0]).finding_id ?? "");
  if (!rows[0]) return [];
  const incident = await incidentRows(folder, rows[0].incident_id);
  const finding = incident.find((row) => row.action_id === findingId);
  return (payloadOf(finding).trace_ids as string[] | undefined) ?? [];
}

export default [
  {
    says: `${FILE} names the action you approved`,
    test: async (folder) => isActionId(actionId(folder)) && (await actionRows(folder)).length > 0,
    tryNext: `write a line Action id: act-... in ${FILE}, copied from the approval page`,
  },
  {
    says: "a person approved it: a remediation_approved row with an email as the actor",
    test: async (folder) => {
      const approved = approval(await actionRows(folder));
      return Boolean(approved?.actor.includes("@")) && approved?.actor !== "ai-sre";
    },
    tryNext:
      "open the action in Harbour Control at http://localhost:8090 and press Approve, " +
      "or run bun run approve --yes",
  },
  {
    says: "the approval came after the proposal was stored as pending",
    test: async (folder) => {
      const rows = await actionRows(folder);
      const approvedAt = firstTime(rows, "remediation_approved");
      return approvedAt !== "" && firstTime(rows, "remediation_proposed") < approvedAt;
    },
    tryNext: "approve a change that is waiting as pending, not one that already ran",
  },
  {
    says: "you read the evidence: Evidence names a trace id of the finding",
    test: async (folder) => {
      const traceIds = await findingTraceIds(folder, await actionRows(folder));
      return traceIds.includes(field(read(folder, FILE), "Evidence").toLowerCase());
    },
    tryNext:
      "open one trace id from the approval page in HyperDX, then copy that full trace id " +
      "into the Evidence line",
  },
  {
    says: "you read the blast radius of this action: Blast radius is copied from the page",
    test: async (folder) => {
      const plan = currentPlan(await actionRows(folder));
      const original = blastRadiusText(plan.action ?? "");
      const copy = field(read(folder, FILE), "Blast radius");
      return original !== "" && sharesWords(copy, original, 8);
    },
    tryNext:
      "copy the sentence about who is affected from the Blast radius box of this action's " +
      "approval page",
  },
] satisfies Rule[];
