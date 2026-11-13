// score-the-ai-sre: a scored run of your AI SRE over the four given incidents, three runs each.
// Every run must be real (its rows are in the audit log), and evals/report-baseline.md must be
// the scorer's own output, so the scorecard cannot be written by hand.
import { GIVEN_CASES, groundTruth } from "../parts/07-prove-the-ai-sre-right/incident-set";
import { agentCommand } from "../parts/07-prove-the-ai-sre-right/run-evals";
import { passingColumn, reportFile } from "../parts/07-prove-the-ai-sre-right/score";
import {
  onlyApprovedChangesRan,
  RUNS_PER_CASE,
  runsByCase,
  scoreLabel,
} from "../parts/07-prove-the-ai-sre-right/scorer";
import { runIsInTheWorld } from "../parts/07-prove-the-ai-sre-right/world-check";
import type { Rule } from "../scripts/verify";
import { read } from "./lib/files";

const LABEL = "baseline";
const allRuns = (folder: string) => [...runsByCase(folder, LABEL).values()].flat();

export default [
  {
    says: "evals/agent.toml names the command that runs your AI SRE, under [baseline]",
    test: (folder) => agentCommand(folder, LABEL).length > 0,
    tryNext:
      'set command = "bun parts/07-prove-the-ai-sre-right/reference-agent.ts" under [baseline], ' +
      "or the command that starts your own agent",
  },
  {
    says: "the four given incidents are in evals/incidents/",
    test: (folder) => GIVEN_CASES.every((name) => groundTruth(folder, name) !== null),
    tryNext: "copy evals/incidents from build-the-incident-set into this folder",
  },
  {
    says: `each given incident has ${RUNS_PER_CASE} runs in evals/runs/baseline/`,
    test: (folder) => {
      const byCase = runsByCase(folder, LABEL);
      return GIVEN_CASES.every((name) => (byCase.get(name)?.length ?? 0) >= RUNS_PER_CASE);
    },
    tryNext:
      "run bun parts/07-prove-the-ai-sre-right/run-evals.ts score-the-ai-sre; one run can be " +
      "luck, so the scorer needs three",
  },
  {
    says: "every run is real: its audit rows are in harbour-control's audit log",
    test: async (folder) => {
      const runs = allRuns(folder);
      const checked = await Promise.all(runs.map((run) => runIsInTheWorld(folder, run)));
      return runs.length > 0 && checked.every(Boolean);
    },
    tryNext:
      "save runs with run-evals.ts against your running world; never write a run file by hand",
  },
  {
    says: "no run executed a change that a human had not approved",
    test: (folder) => {
      const runs = allRuns(folder);
      return runs.length > 0 && runs.every(onlyApprovedChangesRan);
    },
    tryNext: "your agent ran a change before approval; make it stop after propose_remediation",
  },
  {
    says: "evals/report-baseline.md is the scorer's output for these runs",
    test: (folder) => {
      const report = passingColumn(read(folder, reportFile(LABEL)));
      const scores = scoreLabel(folder, LABEL);
      const matches = scores.every((score) => {
        return report.get(score.caseName) === `${score.passing}/${score.runs}`;
      });
      return scores.length > 0 && matches;
    },
    tryNext:
      "run bun parts/07-prove-the-ai-sre-right/score.ts score-the-ai-sre again after your last " +
      "run, and do not edit the report",
  },
] satisfies Rule[];
