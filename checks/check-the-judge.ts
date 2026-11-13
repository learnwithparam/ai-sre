// check-the-judge: your 20 hand labels against the judge's verdicts. On the test half, the judge
// must agree with you on at least 90% of the sentences you passed (TPR) and of those you failed
// (TNR). In replay mode the verdicts must be the judge's recorded ones, not typed by hand.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "../parts/07-prove-the-ai-sre-right/incident-set";
import {
  agreement,
  type Hypothesis,
  readHypotheses,
  readLabels,
  replayVerdict,
} from "../parts/07-prove-the-ai-sre-right/judge";
import type { Rule } from "../scripts/verify";

const LEAST_AGREEMENT = 0.9;
type Verdicts = { provider?: string; verdicts?: Record<string, string> };

const verdictsFile = (folder: string) =>
  readJson<Verdicts>(join(folder, "evals", "judge-verdicts.json")) ?? {};

function testRows(folder: string) {
  const labels = readLabels(folder);
  const verdicts = verdictsFile(folder).verdicts ?? {};
  const testHalf = readHypotheses(folder).filter((hypothesis) => hypothesis.split === "test");
  return testHalf.map((hypothesis) => ({
    label: labels.get(hypothesis.id) ?? "",
    verdict: verdicts[hypothesis.id] ?? "",
  }));
}

function verdictsAreTheJudges(folder: string, hypotheses: Hypothesis[]): boolean {
  const file = verdictsFile(folder);
  const verdicts = file.verdicts ?? {};
  const complete = hypotheses.every((hypothesis) =>
    ["PASS", "FAIL"].includes(verdicts[hypothesis.id]),
  );
  if (!complete || file.provider !== "replay") return complete;
  return hypotheses.every(
    (hypothesis) => verdicts[hypothesis.id] === replayVerdict(hypothesis.sentence),
  );
}

export default [
  {
    says: "evals/labels.csv labels all 20 sentences Pass or Fail",
    test: (folder) => {
      const labels = readLabels(folder);
      const hypotheses = readHypotheses(folder);
      const labelled = hypotheses.filter((hypothesis) =>
        ["pass", "fail"].includes(labels.get(hypothesis.id) ?? ""),
      );
      return hypotheses.length === 20 && labelled.length === 20;
    },
    tryNext:
      "read each sentence in evals/hypotheses.csv " +
      "and write Pass or Fail after its id in labels.csv",
  },
  {
    says: "the test half has at least three Pass and three Fail labels, so both rates count",
    test: (folder) => {
      const rows = testRows(folder);
      const passes = rows.filter((row) => row.label === "pass").length;
      const fails = rows.filter((row) => row.label === "fail").length;
      return passes >= 3 && fails >= 3;
    },
    tryNext:
      "label each sentence on its own merits; a sentence that only names a symptom, " +
      "or blames a red herring, is a Fail",
  },
  {
    says: "evals/judge-verdicts.json holds the judge's verdict on every sentence",
    test: (folder) =>
      existsSync(join(folder, "evals", "judge-verdicts.json")) &&
      verdictsAreTheJudges(folder, readHypotheses(folder)),
    tryNext:
      "run bun parts/07-prove-the-ai-sre-right/judge.ts check-the-judge, " +
      "and do not edit its output",
  },
  {
    says: "on the test half, the judge passes at least 90% of the sentences you passed (TPR)",
    test: (folder) => agreement(testRows(folder)).truePositiveRate >= LEAST_AGREEMENT,
    tryNext:
      "find the test sentences you passed and the judge failed; if your label is wrong fix it, " +
      "if the judge is wrong make judge.md clearer and judge again",
  },
  {
    says: "on the test half, the judge fails at least 90% of the sentences you failed (TNR)",
    test: (folder) => agreement(testRows(folder)).trueNegativeRate >= LEAST_AGREEMENT,
    tryNext:
      "find the test sentences you failed and the judge passed; tell judge.md to fail a sentence " +
      "that names no mechanism, then judge again",
  },
] satisfies Rule[];
