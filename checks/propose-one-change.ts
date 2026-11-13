// propose-one-change: the learner's AI SRE proposes one change for its bad-release finding.
// The check reads the proposal harbour-control stored and the finding it rests on.
import {
  type AuditRow,
  currentPlan,
  incidentRows,
  isActionId,
  payloadOf,
  readJson,
  rightAction,
  rowsFor,
  samePlan,
} from "../parts/05-ask-before-you-act/audit";
import type { Rule } from "../scripts/verify";

const FILE = "change.json";
const PROBLEM_FOLDER = "parts/05-ask-before-you-act/01-propose-one-change/problem";
const CALL_TOOL = "bun parts/05-ask-before-you-act/call-tool.ts";
const SEND = `${CALL_TOOL} propose_remediation ${PROBLEM_FOLDER}/${FILE}`;
const right = rightAction("bad-release");

async function proposalRows(folder: string): Promise<AuditRow[]> {
  const rows = await rowsFor(folder, readJson(folder, FILE).action_id ?? "");
  return rows[0]?.kind === "remediation_proposed" ? rows : [];
}

async function storedFinding(folder: string): Promise<AuditRow | undefined> {
  const [proposed] = await proposalRows(folder);
  if (!proposed) return undefined;
  const findingId = String(payloadOf(proposed).finding_id ?? "");
  const rows = await incidentRows(folder, proposed.incident_id);
  return rows.find((row) => row.kind === "finding_submitted" && row.action_id === findingId);
}

export default [
  {
    says: `${FILE} holds the action_id that propose_remediation returned`,
    test: (folder) => isActionId(readJson(folder, FILE).action_id),
    tryNext: `fill in incident_id, finding_id, action, target and params, then send it: ${SEND}`,
  },
  {
    says: "harbour-control stored the proposal: a remediation_proposed row",
    test: async (folder) => (await proposalRows(folder)).length > 0,
    tryNext:
      "an action_id you typed is not stored. Read the REFUSED line, fix the field it names, " +
      "and send the file again",
  },
  {
    says: "it rests on a stored finding for the same incident",
    test: async (folder) => (await storedFinding(folder)) !== undefined,
    tryNext:
      "submit your finding first (as in write-the-finding), then copy its finding_id into " +
      `${FILE}`,
  },
  {
    says: "the finding blames the planted fault: booking-web, release v2",
    test: async (folder) => {
      const finding = payloadOf(await storedFinding(folder));
      const change = finding.change as { kind?: string; value?: string } | undefined;
      return finding.service === "booking-web" && change?.value === "v2";
    },
    tryNext: "propose against the finding that blames release v2 of booking-web",
  },
  {
    says: `it is the right change for that fault: ${right.action} ${right.target} to v1`,
    test: async (folder) => samePlan(currentPlan(await proposalRows(folder)), right),
    tryNext:
      "a restart keeps the broken release running. Ask for rollback_release on booking-web " +
      'with params {"release": "v1"}',
  },
  {
    says: "it is the only change proposed for this incident",
    test: async (folder) => {
      const [proposed] = await proposalRows(folder);
      if (!proposed) return false;
      const rows = await incidentRows(folder, proposed.incident_id);
      return rows.filter((row) => row.kind === "remediation_proposed").length === 1;
    },
    tryNext:
      "propose once per incident. Plant the fault again with bun run world break bad-release " +
      "and propose one change for the new incident",
  },
] satisfies Rule[];
