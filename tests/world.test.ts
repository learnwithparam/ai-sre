// Structural tests for the spine: one source of truth for the finished hooks, and replay that cites this run.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allSteps, parts } from "../scripts/structure";

const ROOT = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

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
  const listed = [...read("PARTS.md").matchAll(/^## `parts\/([^`]+)`/gm)].map((m) => m[1]);
  const folders = parts()
    .filter((p) => p.name !== "orientation")
    .map((p) => p.dir.split("/").pop());
  expect(listed).toEqual(folders);
});

test("every step named in a part README table is unique across the course", () => {
  const names = parts().flatMap((p) =>
    [
      ...read(join(p.dir.replace(ROOT + "/", ""), "README.md")).matchAll(
        /^\| `([a-z-]+)` \| \d+/gm,
      ),
    ].map((m) => m[1]),
  );
  expect(new Set(names).size).toBe(names.length);
  for (const s of allSteps()) if (s.part !== "orientation") expect(names).toContain(s.name);
});

test("every planted scenario has ground truth that names a service and a change kind", () => {
  for (const s of [
    "bad-release",
    "timetable-hang",
    "fare-file-push",
    "noisy-morning",
    "injection",
  ]) {
    const g = JSON.parse(read(`world/scenarios/${s}.json`));
    expect(g.scenario).toBe(s);
    expect(["release", "config", "none"]).toContain(g.change.kind);
  }
});

test("harbour-control's action list and the scenarios agree", () => {
  const policy = read("world/harbour-control/harbour_control/policy.py");
  for (const s of ["bad-release", "timetable-hang", "fare-file-push"]) {
    const g = JSON.parse(read(`world/scenarios/${s}.json`));
    expect(policy).toContain(`"${g.right_action.action}"`);
  }
});

test("replay resolves references to this run's tool results", async () => {
  const { generateText } = await import("ai");
  const { replayModel } = await import("../agent/replay");
  const { tool, jsonSchema } = await import("ai");
  const seen: unknown[] = [];
  const tools = {
    list_incidents: tool({
      inputSchema: jsonSchema({ type: "object" }),
      execute: async () => ({ incidents: [{ id: "inc-1" }] }),
    }),
    get_incident: tool({
      inputSchema: jsonSchema({ type: "object" }),
      execute: async (i: unknown) => {
        seen.push(i);
        return { ok: true };
      },
    }),
  };
  const r = await generateText({
    model: replayModel("execute"),
    prompt: "x",
    tools,
    stopWhen: (await import("ai")).isStepCount(3),
  });
  expect(seen[0]).toEqual({ incident_id: "inc-1" });
  expect(r.steps.length).toBeGreaterThan(1);
});
