// The assignment check must fail on the untouched starter and pass on the reference solution.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { rules } from "../checks/trace-the-model-calls";

const ROOT = join(import.meta.dir, "..");
const SOLUTION = join(
  ROOT,
  "parts/08-trace-model-calls-with-clickstack/01-trace-the-model-calls/solution",
);

async function passing(folder: string): Promise<boolean[]> {
  const results: boolean[] = [];
  for (const rule of rules) {
    const outcome = await Promise.resolve(rule.test(folder)).catch(() => false);
    results.push(outcome);
  }
  return results;
}

test("the starter in assignment/ fails every Done-when line", async () => {
  expect((await passing(join(ROOT, "assignment"))).some(Boolean)).toBe(false);
});

test("the reference solution passes every Done-when line", async () => {
  expect((await passing(SOLUTION)).every(Boolean)).toBe(true);
});
