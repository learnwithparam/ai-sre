// Structural tests for the spine: one source of truth for the finished hooks, and replay that
// cites this run.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allSteps, parts } from "../scripts/structure";

const ROOT = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

test("the world's finished hooks are the part one solutions, byte for byte", () => {
  const pairs: [string, string][] = [
    [
      "world/booking-web/src/hooks/telemetry.ts",
      "parts/01-see-every-signal/02-tag-the-release/solution/telemetry.ts",
    ],
    [
      "world/booking-web/src/hooks/checkin.ts",
      "parts/01-see-every-signal/03-add-the-checkin-span/solution/checkin.ts",
    ],
    [
      "world/booking-web/src/hooks/redact.ts",
      "parts/01-see-every-signal/04-hide-the-email/solution/redact.ts",
    ],
  ];
  for (const [world, solution] of pairs) expect(read(solution)).toBe(read(world));
});

test("every part in PARTS.md is a folder, and every folder is in PARTS.md", () => {
  const headings = read("PARTS.md").matchAll(/^## `parts\/([^`]+)`/gm);
  const listed = [...headings].map((match) => match[1]);
  const folders = parts()
    .filter((part) => part.name !== "orientation")
    .map((part) => part.dir.split("/").pop());
  expect(listed).toEqual(folders);
});

// Reads the step names from the table in one part's README.
function stepsInPartTable(partDir: string): string[] {
  const readme = read(join(partDir.replace(`${ROOT}/`, ""), "README.md"));
  const rows = readme.matchAll(/^\| `([a-z-]+)` +\| \d+/gm);
  return [...rows].map((match) => match[1]);
}

test("every step named in a part README table is unique across the course", () => {
  const names = parts().flatMap((part) => stepsInPartTable(part.dir));
  expect(new Set(names).size).toBe(names.length);
  for (const step of allSteps()) {
    if (step.part !== "orientation") expect(names).toContain(step.name);
  }
});

test("every planted scenario has ground truth that names a service and a change kind", () => {
  const scenarios = [
    "bad-release",
    "timetable-hang",
    "fare-file-push",
    "noisy-morning",
    "injection",
  ];
  for (const scenario of scenarios) {
    const groundTruth = JSON.parse(read(`world/scenarios/${scenario}.json`));
    expect(groundTruth.scenario).toBe(scenario);
    expect(["release", "config", "none"]).toContain(groundTruth.change.kind);
  }
});

test("harbour-control's action list and the scenarios agree", () => {
  const policy = read("world/harbour-control/harbour_control/policy.py");
  for (const scenario of ["bad-release", "timetable-hang", "fare-file-push"]) {
    const groundTruth = JSON.parse(read(`world/scenarios/${scenario}.json`));
    expect(policy).toContain(`"${groundTruth.right_action.action}"`);
  }
});

test("replay resolves references to this run's tool results", async () => {
  const { generateText, isStepCount, jsonSchema, tool } = await import("ai");
  const { replayModel } = await import("../agent/replay");
  const seen: unknown[] = [];
  // Tool names are the wire names the recorded run used, so they stay in snake_case.
  // biome-ignore-start lint/style/useNamingConvention: recorded tool and argument names.
  const tools = {
    list_incidents: tool({
      inputSchema: jsonSchema({ type: "object" }),
      execute: async () => ({ incidents: [{ id: "inc-1" }] }),
    }),
    get_incident: tool({
      inputSchema: jsonSchema({ type: "object" }),
      execute: async (input: unknown) => {
        seen.push(input);
        return { ok: true };
      },
    }),
  };
  const result = await generateText({
    model: replayModel("execute"),
    prompt: "x",
    tools,
    stopWhen: isStepCount(3),
  });
  expect(seen[0]).toEqual({ incident_id: "inc-1" });
  // biome-ignore-end lint/style/useNamingConvention: recorded tool and argument names.
  expect(result.steps.length).toBeGreaterThan(1);
});
