// Capstone check: bun capstone/check.ts <folder>. Reads only incident-review.md in the folder you
// give it. It proves the shape of the review: your own service name, two kinds of evidence with a
// place and a time, a finding, one change with its approver, and a proof. It cannot prove the
// evidence is real; the share step does that when a teammate opens each line.
import { existsSync } from "node:fs";
import { join } from "node:path";
import rules from "../checks/do-it-on-your-own-service";
import type { Rule } from "../scripts/verify";

const folder = process.argv[2];
if (!folder || !existsSync(join(folder, "incident-review.md"))) {
  console.log("Usage: bun capstone/check.ts <folder that holds incident-review.md>");
  process.exit(2);
}
const failed = (rules as Rule[]).filter((rule) => {
  try {
    return !rule.test(folder);
  } catch {
    return true;
  }
});
for (const rule of failed) console.log(`FAIL ${rule.says}: ${rule.tryNext}`);
if (failed.length === 0) console.log(`Done. All ${rules.length} rules pass.`);
process.exit(failed.length === 0 ? 0 : 1);
