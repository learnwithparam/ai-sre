// Reads the repo layout once. Every other script asks this file where things are.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");

export type Step = {
  name: string; // verb-the-thing, also the command argument
  dir: string;
  part: string;
  meta: { minutes: number; screen: boolean; solution: boolean };
};
export type Part = { name: string; dir: string; steps: Step[] };

type StepToml = { minutes?: number; screen?: boolean; solution?: boolean };

function subfolders(folder: string): string[] {
  if (!existsSync(folder)) return [];
  const names = readdirSync(folder).filter((name) => statSync(join(folder, name)).isDirectory());
  return names.sort();
}

// Folders keep an order prefix for sorting only. Learners never type it.
export const bareName = (folder: string) => folder.replace(/^\d+-/, "");

function readStep(partFolder: string, partName: string, stepFolder: string): Step {
  const stepDir = join(partFolder, stepFolder);
  const metaPath = join(stepDir, "step.toml");
  const raw: StepToml = existsSync(metaPath)
    ? (Bun.TOML.parse(readFileSync(metaPath, "utf8")) as StepToml)
    : {};
  return {
    name: bareName(stepFolder),
    dir: stepDir,
    part: bareName(partName),
    meta: {
      minutes: Number(raw.minutes ?? 0),
      screen: Boolean(raw.screen),
      solution: Boolean(raw.solution),
    },
  };
}

export function parts(): Part[] {
  const root = join(ROOT, "parts");
  // The orientation is a part too: its one step is checked like any other, and every
  // schedule includes it.
  const orientation = join(ROOT, "00-orientation");
  const folders = [
    ...(existsSync(orientation) ? [orientation] : []),
    ...subfolders(root).map((partFolder) => join(root, partFolder)),
  ];
  return folders.map((dir) => {
    const partName = dir === orientation ? "orientation" : (dir.split("/").pop() as string);
    const steps = subfolders(dir)
      .filter((stepFolder) => existsSync(join(dir, stepFolder, "step.toml")))
      .map((stepFolder) => readStep(dir, partName, stepFolder));
    return { name: bareName(partName), dir, steps };
  });
}

export const allSteps = () => parts().flatMap((part) => part.steps);

export function findStep(name: string): Step | undefined {
  return allSteps().find((step) => step.name === name);
}
