// bun parts/02-know-when-it-is-broken/replay-rule.ts <rule.sql>
// Replays one alert rule through the two recorded mornings at Gullrock, one check every
// 30 seconds, and draws what the rule did: P when it pages, a dot when it is quiet.
// The rule is one SELECT that returns a column called page (or anomalous), with 1 or 0.
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { isPaging, type Moment, replayRule } from "./replay";

const RECORDINGS = ["bad-release", "noisy-morning"];

function pageColumn(timeline: Moment[]): string {
  const firstRow = timeline.find((moment) => moment.error === "")?.row ?? {};
  if ("anomalous" in firstRow && !("page" in firstRow)) return "anomalous";
  return "page";
}

function drawTimeline(timeline: Moment[]): string {
  const column = pageColumn(timeline);
  return timeline
    .map((moment) => {
      if (moment.error) return "x";
      if (isPaging(moment, column)) return "P";
      return ".";
    })
    .join("");
}

const ruleFile = process.argv[2];
if (!ruleFile || !existsSync(ruleFile)) {
  console.log("Name a rule file, for example:");
  console.log(
    "  bun parts/02-know-when-it-is-broken/replay-rule.ts " +
      "parts/02-know-when-it-is-broken/04-count-the-pages/problem/old-alert.sql",
  );
  process.exit(1);
}

const sql = readFileSync(ruleFile, "utf8");
console.log(`Replaying ${basename(ruleFile)}, one check every 30 seconds.`);
console.log("P means the rule pages at that check. A dot means it is quiet.\n");
let firstError = "";
for (const recording of RECORDINGS) {
  const timeline = await replayRule(recording, sql);
  firstError ||= timeline.find((moment) => moment.error)?.error ?? "";
  console.log(`${recording.padEnd(15)} ${drawTimeline(timeline)}`);
}
if (firstError) {
  console.log(`\nx means the rule failed at that check. The first error:\n  ${firstError}`);
}
console.log("\nA run of P next to each other is one page: the alert stays on until it is quiet.");
