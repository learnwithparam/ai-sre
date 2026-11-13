// The judge: one model call that reads one hypothesis sentence and answers PASS or FAIL.
// In replay mode (no key) it answers from judge-replay.json, the judge's recorded verdicts.
//
// bun parts/07-prove-the-ai-sre-right/judge.ts <step-name>
//   judges every sentence in that step's evals/hypotheses.csv with evals/judge.md, writes
//   evals/judge-verdicts.json, and shows how often the judge agrees with your dev labels.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateText } from "ai";
import { model, provider } from "../../config/models";
import { findStep } from "../../scripts/structure";
import { readJson } from "./incident-set";

export type Verdict = "PASS" | "FAIL" | "NOT RECORDED";
export type Hypothesis = { id: string; caseName: string; split: string; sentence: string };

const REPLAY = join(import.meta.dir, "judge-replay.json");

// One row per line: id,case,split,sentence. The sentence is last, so it may hold commas.
export function readHypotheses(folder: string): Hypothesis[] {
  const path = join(folder, "evals", "hypotheses.csv");
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").trim().split("\n").slice(1);
  return lines.map((line) => {
    const [id, caseName, split, ...rest] = line.split(",");
    return {
      id: id.trim(),
      caseName: caseName.trim(),
      split: split.trim(),
      sentence: rest.join(",").trim(),
    };
  });
}

// One row per line: id,label. The label is Pass or Fail.
export function readLabels(folder: string): Map<string, string> {
  const labels = new Map<string, string>();
  const path = join(folder, "evals", "labels.csv");
  if (!existsSync(path)) return labels;
  for (const line of readFileSync(path, "utf8").trim().split("\n").slice(1)) {
    const [id, label = ""] = line.split(",").map((cell) => cell.trim());
    labels.set(id, label.toLowerCase());
  }
  return labels;
}

export function replayVerdict(sentence: string): Verdict {
  const recorded = readJson<{ verdicts: Record<string, Verdict> }>(REPLAY);
  return recorded?.verdicts[sentence] ?? "NOT RECORDED";
}

async function liveVerdict(sentence: string, caseSummary: string, judgePrompt: string) {
  const result = await generateText({
    model: model("judge"),
    system: judgePrompt,
    prompt: `What really happened: ${caseSummary}\n\nThe AI SRE's hypothesis: ${sentence}`,
  });
  const answer = result.text.trim().toUpperCase();
  return answer.startsWith("PASS") ? "PASS" : "FAIL";
}

export async function judge(sentence: string, caseSummary: string, judgePrompt: string) {
  if (provider() === "replay") return replayVerdict(sentence);
  return (await liveVerdict(sentence, caseSummary, judgePrompt)) as Verdict;
}

export type Rates = { truePositiveRate: number; trueNegativeRate: number };

// TPR: of the sentences you labelled Pass, the share the judge passed.
// TNR: of the sentences you labelled Fail, the share the judge failed.
export function agreement(rows: { label: string; verdict: string }[]): Rates {
  const positives = rows.filter((row) => row.label === "pass");
  const negatives = rows.filter((row) => row.label === "fail");
  const passed = positives.filter((row) => row.verdict === "PASS").length;
  const failed = negatives.filter((row) => row.verdict === "FAIL").length;
  return {
    truePositiveRate: positives.length ? passed / positives.length : Number.NaN,
    trueNegativeRate: negatives.length ? failed / negatives.length : Number.NaN,
  };
}

function caseSummary(caseName: string): string {
  const path = join(import.meta.dir, "..", "..", "world", "scenarios", `${caseName}.json`);
  return readJson<{ summary: string }>(path)?.summary ?? "";
}

async function judgeEverySentence(folder: string): Promise<Record<string, Verdict>> {
  const judgePrompt = readFileSync(join(folder, "evals", "judge.md"), "utf8");
  const verdicts: Record<string, Verdict> = {};
  for (const hypothesis of readHypotheses(folder)) {
    const summary = caseSummary(hypothesis.caseName);
    verdicts[hypothesis.id] = await judge(hypothesis.sentence, summary, judgePrompt);
  }
  return verdicts;
}

function printDevAgreement(folder: string, verdicts: Record<string, Verdict>): void {
  const labels = readLabels(folder);
  const dev = readHypotheses(folder).filter((hypothesis) => hypothesis.split === "dev");
  const rows = dev.map((hypothesis) => ({
    label: labels.get(hypothesis.id) ?? "",
    verdict: verdicts[hypothesis.id],
  }));
  const rates = agreement(rows);
  console.log(
    `Dev half: TPR ${rates.truePositiveRate.toFixed(2)}, TNR ${rates.trueNegativeRate.toFixed(2)}`,
  );
  for (const [index, row] of rows.entries()) {
    const disagrees = row.label && row.verdict.toLowerCase() !== row.label;
    if (disagrees)
      console.log(`  ${dev[index].id}: you said ${row.label}, the judge said ${row.verdict}`);
  }
}

if (import.meta.main) {
  const step = findStep(process.argv[2] ?? "check-the-judge");
  if (!step) {
    console.log("Name a step: bun parts/07-prove-the-ai-sre-right/judge.ts check-the-judge");
    process.exit(1);
  }
  const folder = join(step.dir, "problem");
  const verdicts = await judgeEverySentence(folder);
  const output = { provider: provider(), verdicts };
  writeFileSync(
    join(folder, "evals", "judge-verdicts.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );
  console.log(
    `Judged ${Object.keys(verdicts).length} sentences (${provider()} mode). ` +
      "Wrote evals/judge-verdicts.json.",
  );
  printDevAgreement(folder, verdicts);
}
