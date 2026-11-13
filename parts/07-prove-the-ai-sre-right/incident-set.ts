// The incident set: one folder per recorded incident under evals/incidents/, each with a
// ground-truth.json that says what really broke and which signals only look like the cause.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const GIVEN_CASES = ["bad-release", "timetable-hang", "fare-file-push", "noisy-morning"];
export const WORLD_SCENARIOS = [...GIVEN_CASES, "injection"];
export const SERVICES = ["booking-web", "timetable-loader"];
const CHANGE_KINDS = ["release", "config", "none"];

// The fixed action list of harbour-control: action, target, and the allowed parameters.
export const ACTIONS: Record<string, Record<string, Record<string, string>>> = {
  "rollback_release booking-web": { release: "v1" },
  "restart_service timetable-loader": {},
  "restart_service booking-web": {},
  "rollback_config fares": { version: "previous" },
};

export type Action = { action: string; target: string; params: Record<string, string> };
export type Distractor = { signal: string; why: string };

// biome-ignore-start lint/style/useNamingConvention: these are the field names in the JSON files.
export type GroundTruth = {
  scenario: string;
  summary: string;
  service: string;
  change: { kind: string; value: string };
  pattern: string[];
  right_action: Action | null;
  distractors: Distractor[];
  injected_text?: string;
};
// biome-ignore-end lint/style/useNamingConvention: these are the field names in the JSON files.

export const casesFolder = (folder: string) => join(folder, "evals", "incidents");

export function caseNames(folder: string): string[] {
  const incidents = casesFolder(folder);
  if (!existsSync(incidents)) return [];
  return readdirSync(incidents).filter((name) =>
    existsSync(join(incidents, name, "ground-truth.json")),
  );
}

export function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function groundTruth(folder: string, caseName: string): GroundTruth | null {
  return readJson<GroundTruth>(join(casesFolder(folder), caseName, "ground-truth.json"));
}

const isText = (value: unknown) => typeof value === "string" && value.trim().length > 0;

export function actionIsAllowed(action: Action): boolean {
  const allowed = ACTIONS[`${action.action} ${action.target}`];
  if (!allowed) return false;
  const params = action.params ?? {};
  const names = Object.keys(params);
  const sameNames = names.length === Object.keys(allowed).length;
  return sameNames && names.every((name) => allowed[name] === params[name]);
}

function changeProblems(truth: GroundTruth): string[] {
  const problems: string[] = [];
  const kind = truth.change?.kind;
  if (!CHANGE_KINDS.includes(kind)) problems.push("change.kind is release, config or none");
  if (kind !== "none" && !isText(truth.change?.value)) problems.push("change.value names it");
  const fault = kind !== "none" || truth.right_action !== null;
  const patterns = Array.isArray(truth.pattern) ? truth.pattern : [];
  if (fault && !patterns.some(isText)) problems.push("pattern lists the words of the new log line");
  return problems;
}

// What is wrong with one ground truth, in plain words. An empty list means it is valid.
export function groundTruthProblems(truth: GroundTruth | null, caseName: string): string[] {
  if (!truth) return ["ground-truth.json is not valid JSON"];
  const problems = changeProblems(truth);
  if (truth.scenario !== caseName) problems.push(`scenario is "${caseName}", the folder name`);
  if (!isText(truth.summary)) problems.push("summary says what broke in one or two sentences");
  if (!SERVICES.includes(truth.service)) problems.push(`service is one of ${SERVICES.join(", ")}`);
  if (truth.right_action !== null && !actionIsAllowed(truth.right_action ?? ({} as Action))) {
    problems.push("right_action is null or an action from the action list");
  }
  const distractors = Array.isArray(truth.distractors) ? truth.distractors : null;
  const complete = (item: Distractor) => isText(item?.signal) && isText(item?.why);
  if (!distractors?.every(complete)) problems.push("each distractor has a signal and a why");
  return problems;
}
