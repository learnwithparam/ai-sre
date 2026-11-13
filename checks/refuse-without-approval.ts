// refuse-without-approval: the learner's AI SRE tries to run its change before a person
// approved it. The check reads the audit log: the attempt was refused and nothing ran.
import {
  type AuditRow,
  firstTime,
  isActionId,
  payloadOf,
  readJson,
  rowsFor,
} from "../parts/05-ask-before-you-act/audit";
import type { Rule } from "../scripts/verify";

const FILE = "run.json";
const RUN = `bun parts/05-ask-before-you-act/call-tool.ts execute_remediation <path to ${FILE}>`;

async function actionRows(folder: string): Promise<AuditRow[]> {
  const rows = await rowsFor(folder, readJson(folder, FILE).action_id ?? "");
  return rows[0]?.kind === "remediation_proposed" ? rows : [];
}

function refusedWhilePending(rows: AuditRow[]): AuditRow | undefined {
  const refused = rows.filter((row) => row.kind === "remediation_refused");
  return refused.find((row) => payloadOf(row).state === "pending");
}

// Timestamps compare as text because they share one format.
function earlier(first: string, second: string): boolean {
  return second === "" || first < second;
}

export default [
  {
    says: `${FILE} names the action_id of a stored proposal`,
    test: async (folder) =>
      isActionId(readJson(folder, FILE).action_id) && (await actionRows(folder)).length > 0,
    tryNext: `copy the action_id from propose-one-change into ${FILE}`,
  },
  {
    says: "the attempt to run it was refused while it was pending: a remediation_refused row",
    test: async (folder) => refusedWhilePending(await actionRows(folder)) !== undefined,
    tryNext: `before anyone approves, run: ${RUN}. You should see a REFUSED line`,
  },
  {
    says: "the refusal came before any approval",
    test: async (folder) => {
      const rows = await actionRows(folder);
      const refused = refusedWhilePending(rows);
      return refused !== undefined && earlier(refused.ts, firstTime(rows, "remediation_approved"));
    },
    tryNext:
      "try to run the change first, and approve it only after. Propose a new change if this " +
      "one is already approved",
  },
  {
    says: "nothing ran before a person approved it",
    test: async (folder) => {
      const rows = await actionRows(folder);
      const executed = firstTime(rows, "remediation_executed");
      const approved = firstTime(rows, "remediation_approved");
      return rows.length > 0 && (executed === "" || (approved !== "" && approved < executed));
    },
    tryNext:
      "an executed row before an approved row means the stop failed. " +
      "Run bun run world heal and tell the course team",
  },
] satisfies Rule[];
