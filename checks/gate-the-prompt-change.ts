// gate-the-prompt-change: a changed agent (the challenger) is scored on the same incidents as
// the baseline, three runs each, and is accepted only if no incident gets worse.
import { agentCommand } from "../parts/07-prove-the-ai-sre-right/run-evals";
import { COMPARE_FILE, compareText, tableRows } from "../parts/07-prove-the-ai-sre-right/score";
import { RUNS_PER_CASE, runsByCase, scoreLabel } from "../parts/07-prove-the-ai-sre-right/scorer";
import { runIsInTheWorld } from "../parts/07-prove-the-ai-sre-right/world-check";
import type { Rule } from "../scripts/verify";
import { read } from "./lib/files";

const baselineCases = (folder: string) => [...runsByCase(folder, "baseline").keys()];

async function everyRunIsReal(folder: string): Promise<boolean> {
  const runs = ["baseline", "challenger"].flatMap((label) =>
    [...runsByCase(folder, label).values()].flat(),
  );
  const real = await Promise.all(runs.map((run) => runIsInTheWorld(folder, run)));
  return runs.length > 0 && real.every(Boolean);
}

export default [
  {
    says: "evals/agent.toml has a [challenger] command that differs from [baseline]",
    test: (folder) => {
      const challenger = agentCommand(folder, "challenger");
      return challenger.length > 0 && challenger !== agentCommand(folder, "baseline");
    },
    tryNext:
      "add [challenger] with the changed command, such as the reference agent with " +
      "--prompt evals/challenger-prompt.md",
  },
  {
    says: `every incident with baseline runs has ${RUNS_PER_CASE} challenger runs`,
    test: (folder) => {
      const challenger = runsByCase(folder, "challenger");
      const cases = baselineCases(folder);
      return (
        cases.length > 0 &&
        cases.every((name) => (challenger.get(name)?.length ?? 0) >= RUNS_PER_CASE)
      );
    },
    tryNext:
      "copy evals/runs/baseline from score-the-ai-sre, then run " +
      "bun parts/07-prove-the-ai-sre-right/run-evals.ts gate-the-prompt-change challenger",
  },
  {
    says: "every baseline and challenger run is in the audit log",
    test: (folder) => everyRunIsReal(folder),
    tryNext:
      "save runs with run-evals.ts against your running world; never write a run file by hand",
  },
  {
    says: `${COMPARE_FILE} is the scorer's comparison of these runs`,
    test: (folder) =>
      baselineCases(folder).length > 0 &&
      tableRows(read(folder, COMPARE_FILE)).join() === tableRows(compareText(folder)).join(),
    tryNext: "run bun parts/07-prove-the-ai-sre-right/score.ts gate-the-prompt-change compare",
  },
  {
    says: "no incident passes fewer runs with the challenger than with the baseline",
    test: (folder) => {
      const challenger = new Map(
        scoreLabel(folder, "challenger").map((score) => [score.caseName, score]),
      );
      const baseline = scoreLabel(folder, "baseline");
      return (
        baseline.length > 0 &&
        baseline.every(
          (before) => (challenger.get(before.caseName)?.passing ?? -1) >= before.passing,
        )
      );
    },
    tryNext:
      "read the FAIL incident's failed checks in report-challenger.md; change the prompt so it " +
      "fixes the new case without breaking that one, then run the challenger again",
  },
] satisfies Rule[];
