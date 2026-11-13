// bun parts/07-prove-the-ai-sre-right/score.ts <step-name> [label]
//   scores every run of one label (baseline unless you name another) and writes
//   evals/report-<label>.md
// bun parts/07-prove-the-ai-sre-right/score.ts <step-name> compare
//   compares the challenger runs with the baseline runs and writes evals/compare.md
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findStep } from "../../scripts/structure";
import { groundTruth } from "./incident-set";
import { judge } from "./judge";
import { type CaseScore, runsByCase, scoreLabel } from "./scorer";

export const reportFile = (label: string) => `evals/report-${label}.md`;
export const COMPARE_FILE = "evals/compare.md";

const fraction = (score: CaseScore) => `${score.passing}/${score.runs}`;

// The judge grades only the hypothesis sentence of the first run of each case.
async function judgeColumn(folder: string, label: string, caseName: string): Promise<string> {
  const [firstRun] = runsByCase(folder, label).get(caseName) ?? [];
  const finding = firstRun?.events.find((event) => event.kind === "finding_submitted");
  const sentence = String(finding?.payload.hypothesis ?? "");
  if (!sentence) return "n/a";
  const summary = groundTruth(folder, caseName)?.summary ?? "";
  const promptPath = join(folder, "evals", "judge.md");
  let judgePrompt = "Answer PASS or FAIL.";
  try {
    judgePrompt = readFileSync(promptPath, "utf8");
  } catch {
    // No judge prompt in this folder: the short default above is used.
  }
  return judge(sentence, summary, judgePrompt);
}

export async function reportText(folder: string, label: string): Promise<string> {
  const lines = [
    `# AI SRE scorecard: ${label}`,
    "",
    "Written by score.ts from the audit rows of each run. Do not edit it by hand.",
    "",
    "| incident | runs passing | failed checks | judge |",
    "| --- | --- | --- | --- |",
  ];
  for (const score of scoreLabel(folder, label)) {
    const failed = score.failedChecks.join("; ") || "none";
    const verdict = await judgeColumn(folder, label, score.caseName);
    lines.push(`| ${score.caseName} | ${fraction(score)} | ${failed} | ${verdict} |`);
  }
  return `${lines.join("\n")}\n`;
}

export function compareText(folder: string): string {
  const baseline = scoreLabel(folder, "baseline");
  const challenger = new Map(
    scoreLabel(folder, "challenger").map((score) => [score.caseName, score]),
  );
  const lines = [
    "# Baseline and challenger",
    "",
    "| incident | baseline | challenger | change |",
    "| --- | --- | --- | --- |",
  ];
  for (const before of baseline) {
    const after = challenger.get(before.caseName);
    const afterText = after ? fraction(after) : "no runs";
    const change = after ? after.passing - before.passing : -before.passing;
    lines.push(`| ${before.caseName} | ${fraction(before)} | ${afterText} | ${change} |`);
  }
  return `${lines.join("\n")}\n`;
}

// The table rows of a report with spacing and separator lines removed, so a report that a
// formatter tidied still matches the scorer's own text.
export function tableRows(text: string): string[] {
  const lines = text.split("\n");
  const rows = lines.filter((line) => line.trim().startsWith("|"));
  const cells = rows.map((line) => {
    const pieces = line.split("|");
    return pieces.map((cell) => cell.trim());
  });
  const withoutSeparators = cells.filter((row) => !row.every((cell) => /^-*$/.test(cell)));
  return withoutSeparators.map((row) => row.join("|"));
}

// The "runs passing" column of a report, by incident.
export function passingColumn(text: string, column = 1): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of text.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length > column + 1 && /^\d+\/\d+$/.test(cells[column + 1]))
      rows.set(cells[1], cells[column + 1]);
  }
  return rows;
}

if (import.meta.main) {
  const [stepName = "score-the-ai-sre", what = "baseline"] = process.argv.slice(2);
  const step = findStep(stepName);
  if (!step) {
    console.log("Name a step: bun parts/07-prove-the-ai-sre-right/score.ts score-the-ai-sre");
    process.exit(1);
  }
  const folder = join(step.dir, "problem");
  const fileName = what === "compare" ? COMPARE_FILE : reportFile(what);
  const text = what === "compare" ? compareText(folder) : await reportText(folder, what);
  writeFileSync(join(folder, fileName), text);
  console.log(text);
  console.log(`Wrote ${fileName}.`);
}
