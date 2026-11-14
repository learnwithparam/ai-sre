// do-it-on-your-own-service: the capstone. incident-review.md is about the learner's own service.
// The check proves the shape, and that each piece of evidence points at something real to look up.
// It never reads the course world, and it rejects a review that reuses the course's names.
import type { Rule } from "../scripts/verify";
import { field, hasReason, read } from "./lib/files";

const FILE = "incident-review.md";
const COURSE_NAMES = /booking-web|harbour|gullrock|timetable-loader|inc-b1182f037ed0/i;
const SOURCES = ["log", "trace", "metric", "dashboard", "ticket", "deploy"];

type Evidence = { source: string; where: string; when: string };

function evidence(folder: string): Evidence[] {
  const section = read(folder, FILE).split(/^## Evidence/m)[1]?.split(/^## /m)[0] ?? "";
  const found: Evidence[] = [];
  for (const line of section.split("\n")) {
    const parts = line.match(/^- (\w+) \| (.+) \| (\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/);
    if (parts) found.push({ source: parts[1].toLowerCase(), where: parts[2].trim(), when: parts[3] });
  }
  return found;
}

const text = (folder: string) => read(folder, FILE);

export default [
  {
    says: "the Service line names your own service",
    test: (folder) => field(text(folder), "Service").length > 1 && !COURSE_NAMES.test(text(folder)),
    tryNext: "write the name of a service you run; the course's own names do not count",
  },
  {
    says: "the Evidence section has at least two lines with a source, a place and a time",
    test: (folder) => evidence(folder).length >= 2,
    tryNext: "write lines like - log | payments pod logs, search timeout | 2026-03-02 14:05",
  },
  {
    says: `each piece of evidence names a source: ${SOURCES.join(", ")}`,
    test: (folder) => evidence(folder).length > 0 && evidence(folder).every((item) => SOURCES.includes(item.source)),
    tryNext: `start each evidence line with one of ${SOURCES.join(", ")}`,
  },
  {
    says: "the evidence uses at least two kinds of source",
    test: (folder) => new Set(evidence(folder).map((item) => item.source)).size >= 2,
    tryNext: "add a second kind, such as a deploy line next to a log line, so one source cannot mislead you",
  },
  {
    says: "the Finding says the cause in four words or more",
    test: (folder) => hasReason(field(text(folder), "Finding")),
    tryNext: "write one plain sentence about what broke and why",
  },
  {
    says: "the Change line names one change and the person who must approve it",
    test: (folder) => hasReason(field(text(folder), "Change")) && field(text(folder), "Approver").length > 1,
    tryNext: "write Change: one small action, and Approver: the person who says yes",
  },
  {
    says: "the Proof line says how you will know it worked",
    test: (folder) => hasReason(field(text(folder), "Proof")),
    tryNext: "write what number or log line will change when the fix works",
  },
] satisfies Rule[];
