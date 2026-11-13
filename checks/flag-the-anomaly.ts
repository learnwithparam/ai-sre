// flag-the-anomaly: your 3 sigma rule is replayed every 30 seconds through two recordings.
// It must page while the bad release runs, and stay quiet after the rollback and through
// the noisy morning, where nothing is broken.
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

const FILE = "flag-the-anomaly.sql";
const COLUMNS = ["baseline_mean", "baseline_sigma", "bound", "current_error_rate", "anomalous"];

// The moments that matter in bad-release, each as seconds before the recording ends.
type KeyMoments = { faultStarts: number; rollbackRuns: number };
type Run = { badRelease: Moment[]; noisyMorning: Moment[]; moments: KeyMoments };

async function keyMoments(): Promise<KeyMoments> {
  const events = "SELECT ts AS at FROM sre.incident_events";
  return {
    faultStarts: await secondsBeforeEnd(
      "bad-release",
      "SELECT minIf(Timestamp, StatusCode = 'Error') AS at FROM otel_traces",
    ),
    rollbackRuns: await secondsBeforeEnd(
      "bad-release",
      `${events} WHERE kind = 'remediation_executed' LIMIT 1`,
    ),
  };
}

const runs = new Map<string, Promise<Run>>();

async function replayBoth(folder: string): Promise<Run> {
  const sql = read(folder, FILE);
  return {
    badRelease: await replayRule("bad-release", sql),
    noisyMorning: await replayRule("noisy-morning", sql),
    moments: await keyMoments(),
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
const pages = (moment: Moment) => isPaging(moment, "anomalous");

function boundIsThreeSigma(moment: Moment): boolean {
  const mean = Number(moment.row.baseline_mean);
  const sigma = Number(moment.row.baseline_sigma);
  const bound = Number(moment.row.bound);
  if (Number.isNaN(mean)) return true;
  return Math.abs(bound - (mean + 3 * sigma)) < 1e-6;
}

// The sample answer sets the expected baseline. The check compares your mean with its mean.
const SAMPLE_FOLDER = join(
  import.meta.dir,
  "..",
  "parts",
  "02-know-when-it-is-broken",
  "02-flag-the-anomaly",
  "solution",
);

// True when your baseline mean matches the sample's at every moment of bad-release.
async function sameBaselineAsSample(folder: string): Promise<boolean> {
  const mine = (await run(folder)).badRelease;
  const sample = (await run(SAMPLE_FOLDER)).badRelease;
  return sample.every((expected, index) => {
    const expectedMean = Number(expected.row.baseline_mean);
    if (Number.isNaN(expectedMean)) return true;
    const myMean = Number(mine[index]?.row.baseline_mean);
    return Math.abs(myMean - expectedMean) < 0.002;
  });
}

export default [
  {
    says: `${FILE} holds one SELECT`,
    test: (folder) => isOneSelect(read(folder, FILE)),
    tryNext: `keep one SELECT in ${FILE}; the WITH part at the top belongs to it`,
  },
  {
    says: "the rule runs at every moment of both recordings and returns one row",
    test: async (folder) => {
      const moments = everyMoment(await run(folder));
      return moments.every((moment) => moment.error === "" && "anomalous" in moment.row);
    },
    tryNext:
      "run the query in HyperDX's SQL view and fix the error it shows; " +
      "the last SELECT has no GROUP BY, so it returns one row",
  },
  {
    says: "it returns baseline_mean, baseline_sigma, bound, current_error_rate and anomalous",
    test: async (folder) => {
      const firstRow = (await run(folder)).badRelease[0]?.row ?? {};
      return COLUMNS.every((column) => column in firstRow);
    },
    tryNext: "keep the five column names of the starter; the check reads them by name",
  },
  {
    says: "the bound is baseline_mean + 3 * baseline_sigma",
    test: async (folder) => everyMoment(await run(folder)).every(boundIsThreeSigma),
    tryNext: "write baseline_mean + 3 * baseline_sigma AS bound",
  },
  {
    says: "the baseline leaves out the last minute and every past incident",
    test: (folder) => sameBaselineAsSample(folder),
    tryNext:
      "add AND NOT in_past_incident to the condition of both avgIf and stddevPopIf, " +
      "next to bucket < now() - INTERVAL 60 SECOND",
  },
  {
    says: "it pages while the bad release is failing bookings",
    test: async (folder) => {
      const { badRelease, moments } = await run(folder);
      const whileBroken = badRelease.filter(
        (moment) =>
          moment.secondsBeforeEnd < moments.faultStarts &&
          moment.secondsBeforeEnd > moments.rollbackRuns,
      );
      return whileBroken.some(pages);
    },
    tryNext:
      "a baseline full of old errors has a high bound; leave the past incidents out, " +
      "so a normal morning sets the bound",
  },
  {
    says: "it stays quiet after the rollback",
    test: async (folder) => {
      const { badRelease, moments } = await run(folder);
      const afterRollback = badRelease.filter(
        (moment) => moment.secondsBeforeEnd < moments.rollbackRuns - 60,
      );
      return afterRollback.length > 0 && !afterRollback.some(pages);
    },
    tryNext: "page only when the current rate is above the bound and at least 0.05 above the mean",
  },
  {
    says: "it stays quiet through the noisy morning, where nothing is broken",
    test: async (folder) => {
      const { noisyMorning } = await run(folder);
      return noisyMorning.length > 0 && !noisyMorning.some(pages);
    },
    tryNext:
      "count failed requests from otel_traces, not warning lines from otel_logs; " +
      "card declines are normal and do not fail a request",
  },
] satisfies Rule[];
