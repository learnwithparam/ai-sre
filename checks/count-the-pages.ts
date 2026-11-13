// count-the-pages: the check replays the old alert and your rule through both recordings,
// counts the pages itself, and compares them with the two numbers in your answer.

import {
  countPages,
  isOneSelect,
  isPaging,
  type Moment,
  replayRule,
} from "../parts/02-know-when-it-is-broken/replay";
import type { Rule } from "../scripts/verify";
import { field, read } from "./lib/files";

const ANSWER = "count-the-pages.md";
const OLD_ALERT = "old-alert.sql";
const MY_RULE = "my-rule.sql";

type Timelines = { badRelease: Moment[]; noisyMorning: Moment[] };
type Run = { oldAlert: Timelines; myRule: Timelines };

async function replayBoth(sql: string): Promise<Timelines> {
  return {
    badRelease: await replayRule("bad-release", sql),
    noisyMorning: await replayRule("noisy-morning", sql),
  };
}

const runs = new Map<string, Promise<Run>>();

async function replayBothRules(folder: string): Promise<Run> {
  return {
    oldAlert: await replayBoth(read(folder, OLD_ALERT)),
    myRule: await replayBoth(read(folder, MY_RULE)),
  };
}

function run(folder: string): Promise<Run> {
  let saved = runs.get(folder);
  if (!saved) {
    saved = replayBothRules(folder);
    runs.set(folder, saved);
  }
  return saved;
}

const pages = (moment: Moment) => isPaging(moment, "page");

const pagesIn = (timelines: Timelines) =>
  countPages(timelines.badRelease, "page") + countPages(timelines.noisyMorning, "page");

// The number after a label in your answer, or NaN when the line is empty.
function answered(folder: string, label: string): number {
  const value = field(read(folder, ANSWER), label);
  if (!/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
}

export default [
  {
    says: `${MY_RULE} holds your burn-the-budget rule, one SELECT with a page column`,
    test: async (folder) => {
      const sql = read(folder, MY_RULE);
      const { myRule } = await run(folder);
      const runsEverywhere = myRule.badRelease.every((moment) => moment.error === "");
      return isOneSelect(sql) && /burn_1h/.test(sql) && runsEverywhere;
    },
    tryNext: `paste all of your burn-the-budget.sql into ${MY_RULE}; it returns burn_1h and page`,
  },
  {
    says: "your rule pages for the bad release",
    test: async (folder) => (await run(folder)).myRule.badRelease.some(pages),
    tryNext: "run bun run verify burn-the-budget first; that step proves the rule pages",
  },
  {
    says: "your rule stays quiet through the noisy morning",
    test: async (folder) => {
      const { noisyMorning } = (await run(folder)).myRule;
      return noisyMorning.length > 0 && !noisyMorning.some(pages);
    },
    tryNext: "run bun run verify burn-the-budget first; that step proves the rule stays quiet",
  },
  {
    says: `${OLD_ALERT} is still the old alert`,
    test: (folder) =>
      /countIf\(SeverityText IN \('warn', 'error'\)\) >= 3/.test(read(folder, OLD_ALERT)),
    tryNext: `put back the old alert in ${OLD_ALERT}; you count its pages, you do not fix it`,
  },
  {
    says: "Pages before is the number of pages the old alert sends in both recordings",
    test: async (folder) =>
      answered(folder, "Pages before") === pagesIn((await run(folder)).oldAlert),
    tryNext:
      "replay old-alert.sql, then add up the pages of both lines; " +
      "a run of P next to each other is one page, not one page per P",
  },
  {
    says: "Pages after is the number of pages your rule sends in both recordings",
    test: async (folder) => answered(folder, "Pages after") === pagesIn((await run(folder)).myRule),
    tryNext:
      "replay my-rule.sql and count the runs of P on both lines; " +
      "a run that stays on is still one page",
  },
] satisfies Rule[];
