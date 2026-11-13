// roll-back-the-release: the approved rollback runs once, and harbour-control confirms recovery
// on fresh traffic. The check reads the audit log and, in the live world, the booking page.
import {
  type AuditRow,
  currentPlan,
  happenedInOrder,
  incidentRows,
  isActionId,
  payloadOf,
  readJson,
  rightAction,
  rowsFor,
  samePlan,
} from "../parts/05-ask-before-you-act/audit";
import type { Rule } from "../scripts/verify";
import { sourceFor } from "./lib/world";

const FILE = "run.json";
const RUN = `bun parts/05-ask-before-you-act/call-tool.ts execute_remediation <path to ${FILE}>`;
const right = rightAction("bad-release");

async function actionRows(folder: string): Promise<AuditRow[]> {
  const rows = await rowsFor(folder, readJson(folder, FILE).action_id ?? "");
  return rows[0]?.kind === "remediation_proposed" ? rows : [];
}

async function footerRelease(): Promise<string> {
  const page = await (await fetch("http://localhost:8000/")).text();
  return page.match(/Release (v\d+)/)?.[1] ?? "";
}

// Live: the footer of the booking page. Recorded: the rollback ran and exited cleanly.
async function runsReleaseOne(folder: string, rows: AuditRow[]): Promise<boolean> {
  if (sourceFor(folder).kind === "live") return (await footerRelease()) === "v1";
  const executed = payloadOf(rows.find((row) => row.kind === "remediation_executed"));
  const result = (executed.result ?? {}) as Record<string, unknown>;
  const params = (executed.params ?? {}) as Record<string, unknown>;
  return result.exit_code === 0 && params.release === "v1";
}

export default [
  {
    says: `${FILE} names a stored rollback of booking-web to v1`,
    test: async (folder) => {
      const rows = await actionRows(folder);
      return isActionId(readJson(folder, FILE).action_id) && samePlan(currentPlan(rows), right);
    },
    tryNext: `copy the action_id of your approved rollback into ${FILE}`,
  },
  {
    says: "it ran after a person approved it: approved, then executed",
    test: async (folder) =>
      happenedInOrder(await actionRows(folder), ["remediation_approved", "remediation_executed"]),
    tryNext: `approve it first (approve-with-blast-radius), then run: ${RUN}`,
  },
  {
    says: "harbour-control verified recovery on fresh traffic: verification_passed",
    test: async (folder) =>
      happenedInOrder(await actionRows(folder), ["remediation_executed", "verification_passed"]),
    tryNext:
      "wait about 90 seconds after the change. harbour-control judges a full minute of new " +
      "requests, then run this again",
  },
  {
    says: "the incident is resolved",
    test: async (folder) => {
      const [proposed] = await actionRows(folder);
      if (!proposed) return false;
      const rows = await incidentRows(folder, proposed.incident_id);
      return rows.some((row) => row.kind === "incident_resolved");
    },
    tryNext: "wait for verification_passed. harbour-control resolves the incident right after it",
  },
  {
    says: "booking-web runs release v1 again (the footer of the booking page)",
    test: async (folder) => runsReleaseOne(folder, await actionRows(folder)),
    tryNext:
      "open http://localhost:8000 and read the footer. If it still says v2, the rollback " +
      "did not run",
  },
] satisfies Rule[];
