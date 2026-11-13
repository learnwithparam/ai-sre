// add-the-config-rollback: the learner adds rollback_config to harbour-control's fixed list of
// actions, with blast radius text and a test. The check runs the learner's policy.py in a copy
// of harbour-control, and reads the audit log for the fare-file-push incident it resolved.
import { join } from "node:path";
import {
  type AuditRow,
  happenedInOrder,
  incidentRows,
  payloadOf,
} from "../parts/05-ask-before-you-act/audit";
import {
  askPolicy,
  type PolicyAnswers,
  starterPolicy,
  testsPass,
} from "../parts/05-ask-before-you-act/policy-check";
import type { Rule } from "../scripts/verify";
import { field, read } from "./lib/files";

const POLICY = "policy.py";
const TESTS = "test_rollback_config.py";
const OUR_TEST = "tests/test_rollback_config.py";

// The policy is asked once per folder, because each run starts Python.
const answers = new Map<string, PolicyAnswers | null>();

function ask(folder: string): PolicyAnswers | null {
  if (!answers.has(folder)) answers.set(folder, askPolicy(join(folder, POLICY)));
  return answers.get(folder) ?? null;
}

async function fareIncidentRows(folder: string): Promise<AuditRow[]> {
  const incidentId = field(read(folder, "incident.md"), "Incident id");
  if (!/^inc-[0-9a-f]{12}$/.test(incidentId)) return [];
  return incidentRows(folder, incidentId);
}

function ranThroughRollbackConfig(rows: AuditRow[]): boolean {
  const executed = rows.filter((row) => row.kind === "remediation_executed");
  const config = executed.find((row) => payloadOf(row).action === "rollback_config");
  if (!config) return false;
  const sameAction = rows.filter((row) => row.action_id === config.action_id);
  return happenedInOrder(sameAction, ["remediation_executed", "verification_passed"]);
}

export default [
  {
    says: `${POLICY} lets rollback_config put back the previous fare table`,
    test: (folder) => ask(folder)?.previous_allowed === true,
    tryNext:
      'add "rollback_config": {"fares": {"version": {"previous"}}} to ACTIONS. ' +
      "If Python fails to load the file, run the tests to see the error",
  },
  {
    says: "it refuses an unknown file: a named fare file, or a path",
    test: (folder) => ask(folder)?.named_file_refused === true && ask(folder)?.path_refused,
    tryNext:
      'allow only the value "previous". An agent that may name any file can load a broken one',
  },
  {
    says: "it refuses rollback_config on any target but fares",
    test: (folder) => ask(folder)?.other_target_refused === true,
    tryNext: "list one target under rollback_config: fares",
  },
  {
    says: "BLAST_RADIUS tells the approver who is affected by rollback_config",
    test: (folder) => {
      const text = ask(folder)?.blast_radius ?? "";
      return text.split(/\s+/).length >= 12 && /fare|route/i.test(text);
    },
    tryNext:
      "add a rollback_config entry to BLAST_RADIUS: what changes for passengers, " +
      "and what is lost, in two or three sentences",
  },
  {
    says: "TARGETS tells the agent what fares is",
    test: (folder) => ask(folder)?.target_described === true,
    tryNext: 'add "fares" to TARGETS with one sentence about the fare table file',
  },
  {
    says: `your ${TESTS} passes on your policy`,
    test: (folder) => testsPass(join(folder, POLICY), join(folder, TESTS), OUR_TEST),
    tryNext:
      "your test fails on your own policy. Check that your test calls validate_action with " +
      'the same names as ACTIONS: "rollback_config", "fares" and {"version": "previous"}',
  },
  {
    says: `your ${TESTS} fails on the policy you started from, so it tests the new action`,
    test: (folder) => !testsPass(starterPolicy(), join(folder, TESTS), OUR_TEST),
    tryNext: "call validate_action for rollback_config in your test, and check what it refuses",
  },
  {
    says: "every harbour-control test passes with your policy",
    test: (folder) => testsPass(join(folder, POLICY), join(folder, TESTS), "tests"),
    tryNext: "the runner tests use rollback_config too. Read the first failing test and fix it",
  },
  {
    says: "the fare-file-push incident resolved through rollback_config",
    test: async (folder) => ranThroughRollbackConfig(await fareIncidentRows(folder)),
    tryNext:
      "deploy your policy, break fare-file-push, then propose, approve and run rollback_config. " +
      "Write its Incident id: in incident.md",
  },
] satisfies Rule[];
