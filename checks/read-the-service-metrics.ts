// read-the-service-metrics: metrics.csv has one row per minute and service. The learner reads the
// worst service, its error rate over the last five minutes, and the first minute it went bad.
import type { Rule } from "../scripts/verify";
import { field, read } from "./lib/files";

const ANSWER = "answers/read-the-service-metrics.md";
const BAD = 0.05;

type Row = { minute: string; service: string; requests: number; errors: number };

function rows(folder: string): Row[] {
  return read(folder, "metrics.csv")
    .split("\n")
    .slice(1)
    .map((line) => line.split(",").map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 4 && cells[0])
    .map(([minute, service, requests, errors]) => ({
      minute,
      service,
      requests: Number(requests),
      errors: Number(errors),
    }));
}

function truth(folder: string) {
  const all = rows(folder);
  const minutes = [...new Set(all.map((row) => row.minute))].sort();
  const last = new Set(minutes.slice(-5));
  const rates = new Map<string, number>();
  for (const service of new Set(all.map((row) => row.service))) {
    const recent = all.filter((row) => row.service === service && last.has(row.minute));
    const requests = recent.reduce((total, row) => total + row.requests, 0);
    const errors = recent.reduce((total, row) => total + row.errors, 0);
    rates.set(service, requests ? errors / requests : 0);
  }
  const worst = [...rates.entries()].sort((a, b) => b[1] - a[1])[0];
  const first = all
    .filter((row) => row.service === worst?.[0] && row.errors / row.requests > BAD)
    .map((row) => row.minute)
    .sort()[0];
  return { service: worst?.[0] ?? "", rate: (worst?.[1] ?? 0) * 100, first: first ?? "" };
}

const text = (folder: string) => read(folder, ANSWER);

export default [
  {
    says: "the worst service is the one with the highest error rate over the last five minutes",
    test: (folder) => field(text(folder), "Worst service") === truth(folder).service,
    tryNext: "add up requests and errors for the last five minutes of each service, then divide",
  },
  {
    says: "the error rate is a percent within one point of the real number",
    test: (folder) => {
      const given = field(text(folder), "Error rate");
      if (!/%\s*$/.test(given)) return false;
      return Math.abs(Number.parseFloat(given) - truth(folder).rate) <= 1;
    },
    tryNext: "write the rate as a percent with a sign, such as Error rate: 12%",
  },
  {
    says: "the first bad minute is the first one where that service's errors pass five percent",
    test: (folder) => field(text(folder), "First bad minute") === truth(folder).first,
    tryNext: "scan that service's rows from the top; copy the minute where errors/requests passes 0.05",
  },
  {
    says: "the Reading line says in four words or more what you would look at next",
    test: (folder) => field(text(folder), "Reading").split(/\s+/).filter(Boolean).length >= 4,
    tryNext: "write one sentence, such as Reading: compare errors by release for that service",
  },
] satisfies Rule[];
