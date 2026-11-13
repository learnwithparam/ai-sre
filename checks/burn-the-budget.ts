// burn-the-budget: your burn rate rule is replayed every 30 seconds through two recordings.
// Both burn rates must match the reference, and the page must fire once for the bad release
// and never on the noisy morning.
import { join } from "node:path";
import {
  isOneSelect,
  isPaging,
  type Moment,
  replayRule,
  secondsBeforeEnd,
} from "../parts/02-know-when-it-is-broken/replay";
import type { Rule } from "../scripts/verify";
import { read } from "./lib/files";

const FILE = "burn-the-budget.sql";
const PAGE_ABOVE = 10;
const SAMPLE_FOLDER = join(
  import.meta.dir,
  "..",
  "parts",
  "02-know-when-it-is-broken",
  "03-burn-the-budget",
  "solution",
);

type Run = { badRelease: Moment[]; noisyMorning: Moment[]; faultStarts: number };

const runs = new Map<string, Promise<Run>>();

async function replayBoth(folder: string): Promise<Run> {
  const sql = read(folder, FILE);
  const firstError = "SELECT minIf(Timestamp, StatusCode = 'Error') AS at FROM otel_traces";
  return {
    badRelease: await replayRule("bad-release", sql),
    noisyMorning: await replayRule("noisy-morning", sql),
    faultStarts: await secondsBeforeEnd("bad-release", firstError),
  };
}

function run(folder: string): Promise<Run> {
  let saved = runs.get(folder);
  if (!saved) {
    saved = replayBoth(folder);
    runs.set(folder, saved);
  }
  return saved;
}

const everyMoment = (run: Run) => [...run.badRelease, ...run.noisyMorning];
const pages = (moment: Moment) => isPaging(moment, "page");

// Within 1% of the expected value. A value near zero may be off by 0.01.
function near(value: number, expected: number): boolean {
  return Math.abs(value - expected) <= Math.max(Math.abs(expected) * 0.01, 0.01);
}

// True when your column matches the sample's column at every moment of bad-release.
async function matchesSample(folder: string, column: "burn_5m" | "burn_1h"): Promise<boolean> {
  const mine = (await run(folder)).badRelease;
  const sample = (await run(SAMPLE_FOLDER)).badRelease;
  return sample.every((expected, index) =>
    near(Number(mine[index]?.row[column]), Number(expected.row[column])),
  );
}

function pageFollowsBothWindows(moment: Moment): boolean {
  const bothHigh =
    Number(moment.row.burn_5m) > PAGE_ABOVE && Number(moment.row.burn_1h) > PAGE_ABOVE;
  return pages(moment) === bothHigh;
}

export default [
  {
    says: `${FILE} holds one SELECT`,
    test: (folder) => isOneSelect(read(folder, FILE)),
    tryNext: `keep one SELECT in ${FILE}; a WITH part at the top belongs to it`,
  },
  {
    says: "the rule runs at every moment of both recordings and returns burn_5m, burn_1h and page",
    test: async (folder) => {
      const moments = everyMoment(await run(folder));
      const columns = ["burn_5m", "burn_1h", "page"];
      return moments.every(
        (moment) => moment.error === "" && columns.every((column) => column in moment.row),
      );
    },
    tryNext:
      "run the query in HyperDX's SQL view and fix the error it shows; " +
      "keep the three column names of the starter",
  },
  {
    says: "burn_5m is the error rate of the last 5 minutes divided by the budget of 0.005",
    test: (folder) => matchesSample(folder, "burn_5m"),
    tryNext:
      "count only the last 5 minutes, with countIf(... AND Timestamp > now() - INTERVAL " +
      "5 MINUTE), and divide the error rate by 0.005, not by 0.995 or 0.5",
  },
  {
    says: "burn_1h is the error rate of the last hour divided by the budget of 0.005",
    test: (folder) => matchesSample(folder, "burn_1h"),
    tryNext: "use every request of the last hour: countIf(StatusCode = 'Error') / count() / 0.005",
  },
  {
    says: `the page fires only while both windows burn faster than ${PAGE_ABOVE}`,
    test: async (folder) => everyMoment(await run(folder)).every(pageFollowsBothWindows),
    tryNext: `write burn_5m > ${PAGE_ABOVE} AND burn_1h > ${PAGE_ABOVE} AS page`,
  },
  {
    says: "it pages while the bad release is failing bookings",
    test: async (folder) => {
      const { badRelease, faultStarts } = await run(folder);
      return badRelease.some((moment) => moment.secondsBeforeEnd < faultStarts && pages(moment));
    },
    tryNext: "check the budget: 0.5% is 0.005, so a 7% error rate burns at 14",
  },
  {
    says: "the page is off again when the recording ends, after the rollback",
    test: async (folder) => {
      const lastMoment = (await run(folder)).badRelease.at(-1);
      return !!lastMoment && !pages(lastMoment);
    },
    tryNext:
      "page on the two windows together; the 1 hour window alone stays high long after a fix",
  },
  {
    says: "it stays quiet through the noisy morning, where nothing is broken",
    test: async (folder) => {
      const { noisyMorning } = await run(folder);
      return noisyMorning.length > 0 && !noisyMorning.some(pages);
    },
    tryNext: "count failed requests from otel_traces; card declines are normal and fail no request",
  },
] satisfies Rule[];
