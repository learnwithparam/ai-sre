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

const dirs = (p: string) =>
  existsSync(p)
    ? readdirSync(p)
        .filter((d) => statSync(join(p, d)).isDirectory())
        .sort()
    : [];

// Folders keep an order prefix for sorting only. Learners never type it.
export const bareName = (folder: string) => folder.replace(/^\d+-/, "");

export function parts(): Part[] {
  const root = join(ROOT, "parts");
  // The orientation is a part too: its one step is checked like any other, and every schedule includes it.
  const orientation = join(ROOT, "00-orientation");
  const folders = [
    ...(existsSync(orientation) ? [orientation] : []),
    ...dirs(root).map((p) => join(root, p)),
  ];
  return folders.map((dir) => {
    const p = dir === orientation ? "orientation" : dir.split("/").pop()!;
    const steps = dirs(dir)
      .filter((s) => existsSync(join(dir, s, "step.toml")))
      .map((s) => {
        const sdir = join(dir, s);
        const metaPath = join(sdir, "step.toml");
        const raw = existsSync(metaPath)
          ? (Bun.TOML.parse(readFileSync(metaPath, "utf8")) as any)
          : {};
        return {
          name: bareName(s),
          dir: sdir,
          part: bareName(p),
          meta: {
            minutes: Number(raw.minutes ?? 0),
            screen: Boolean(raw.screen),
            solution: Boolean(raw.solution),
          },
        };
      });
    return { name: bareName(p), dir, steps };
  });
}

export const allSteps = () => parts().flatMap((p) => p.steps);

export function findStep(name: string): Step | undefined {
  return allSteps().find((s) => s.name === name);
}
