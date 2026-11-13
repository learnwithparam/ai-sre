// build-the-incident-set: evals/incidents/ holds the four given incidents and one of your own.
// Your case ships log lines (seed.json), and the reference rule must find its fault in them:
// the pattern shows up only after minute 0, and the distractor shows up before and after.
import { join } from "node:path";
import {
  caseNames,
  casesFolder,
  GIVEN_CASES,
  type GroundTruth,
  groundTruth,
  groundTruthProblems,
  readJson,
  WORLD_SCENARIOS,
} from "../parts/07-prove-the-ai-sre-right/incident-set";
import type { Rule } from "../scripts/verify";

type SeedLine = { minute: number; service: string; body: string };

const ownCases = (folder: string) =>
  caseNames(folder).filter((name) => !WORLD_SCENARIOS.includes(name));

function seedLines(folder: string, caseName: string): SeedLine[] {
  const seed = readJson<{ logs?: SeedLine[] }>(join(casesFolder(folder), caseName, "seed.json"));
  return Array.isArray(seed?.logs) ? seed.logs : [];
}

function validOwnCases(folder: string): { name: string; truth: GroundTruth }[] {
  const valid: { name: string; truth: GroundTruth }[] = [];
  for (const name of ownCases(folder)) {
    const truth = groundTruth(folder, name);
    if (truth && groundTruthProblems(truth, name).length === 0) valid.push({ name, truth });
  }
  return valid;
}

const mentions = (line: SeedLine, words: string) =>
  line.body.toLowerCase().includes(words.toLowerCase());

// The reference rule: a log pattern is the fault when it is new in the incident window.
function patternIsNew(lines: SeedLine[], truth: GroundTruth): boolean {
  const ofService = lines.filter((line) => line.service === truth.service);
  return truth.pattern.every((words) => {
    const during = ofService.filter((line) => line.minute >= 0 && mentions(line, words));
    const before = ofService.filter((line) => line.minute < 0 && mentions(line, words));
    return during.length >= 3 && before.length === 0;
  });
}

function distractorIsThere(lines: SeedLine[], truth: GroundTruth): boolean {
  return truth.distractors.some((distractor) => {
    const found = lines.filter((line) => mentions(line, distractor.signal));
    const before = found.some((line) => line.minute < 0);
    return before && found.some((line) => line.minute >= 0);
  });
}

export default [
  {
    says: `the four given incidents are there and valid: ${GIVEN_CASES.join(", ")}`,
    test: (folder) =>
      GIVEN_CASES.every(
        (name) => groundTruthProblems(groundTruth(folder, name), name).length === 0,
      ),
    tryNext:
      "keep the four given folders in evals/incidents/ as they came; " +
      "copy them back if you changed one",
  },
  {
    says: "one case of your own has a valid ground-truth.json",
    test: (folder) => validOwnCases(folder).length > 0,
    tryNext:
      "rename evals/incidents/my-case to your case name, set scenario to that name, and fill " +
      "summary, service, change, pattern, right_action and distractors",
  },
  {
    says: "your case's seed.json holds log lines before and after minute 0",
    test: (folder) =>
      validOwnCases(folder).some(({ name }) => {
        const lines = seedLines(folder, name);
        return lines.some((line) => line.minute < 0) && lines.some((line) => line.minute >= 0);
      }),
    tryNext:
      "add log lines to seed.json: some with a negative minute (before), some from minute 0 on",
  },
  {
    says: "the reference rule finds your fault: the pattern is new after minute 0",
    test: (folder) =>
      validOwnCases(folder).some(({ name, truth }) => patternIsNew(seedLines(folder, name), truth)),
    tryNext:
      "pick words that appear in at least three lines of the named service from minute 0 on, " +
      "and in no line before it; a line that is always there is not a cause",
  },
  {
    says: "your case has a distractor that shows up before and during the incident",
    test: (folder) =>
      validOwnCases(folder).some(({ name, truth }) =>
        distractorIsThere(seedLines(folder, name), truth),
      ),
    tryNext:
      "add a distractor and log lines with its signal both before and after minute 0, " +
      "so it looks like a cause but is not new",
  },
] satisfies Rule[];
