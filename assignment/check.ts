// bun assignment/check.ts [folder]
// Tests the Done-when lines on assignment/genai.ts, or on a folder that holds a genai.ts,
// and writes assignment/result.json. Exit 0 only when every line passes.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import rules from "../checks/trace-the-model-calls";

const here = import.meta.dir;
const folder = resolve(process.argv[2] ?? here);
const read = (path: string) => readFileSync(path, "utf8");

const semconv = JSON.parse(
  read(join(here, "..", "node_modules/@opentelemetry/semantic-conventions/package.json")),
).version;
const clickstack = read(join(here, "compose.yml")).match(/clickstack-all-in-one:([\w.]+)/)?.[1];

const lines = [];
for (const rule of rules) {
  let ok = false;
  try {
    ok = await rule.test(folder);
  } catch {
    ok = false;
  }
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${rule.says}`);
  if (!ok) console.log(`        Try next: ${rule.tryNext}`);
  lines.push({ line: rule.says, result: ok ? "pass" : "fail" });
}

const tools = { "@opentelemetry/semantic-conventions": semconv, clickstack };
writeFileSync(
  join(here, "result.json"),
  `${JSON.stringify({ version: 1, tools, lines }, null, 2)}\n`,
);
const failed = lines.filter((line) => line.result === "fail").length;
console.log(
  failed ? `${failed} line(s) fail.` : "All Done-when lines pass. Wrote assignment/result.json.",
);
process.exit(failed ? 1 : 0);
