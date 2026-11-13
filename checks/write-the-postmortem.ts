// write-the-postmortem: the full postmortem. Its sections are all there, its Impact numbers
// match the traces and the Postgres bookings table, and its Root causes blame no person.
import {
  clockAfter,
  hasHeading,
  incidentIdIn,
  numberAfter,
  POSTMORTEM,
  section,
} from "../parts/06-write-it-down/postmortem";
import {
  type AuditRow,
  auditRows,
  blamedChange,
  clockOf,
  confirmedBookings,
  failedBookings,
  type ImpactWindow,
  impactWindow,
} from "../parts/06-write-it-down/records";
import type { Rule } from "../scripts/verify";
import { EMAIL, read } from "./lib/files";

const SECTIONS = [
  "Summary",
  "Impact",
  "Timeline",
  "Root causes",
  "Trigger",
  "Resolution",
  "Detection",
  "Lessons learned",
  "What went well",
  "What went wrong",
  "Action items",
];

const BLAME = /human error|careless|should have|fault of|to blame|blamed|negligen|lazy/i;

type Facts = { rows: AuditRow[]; window: ImpactWindow | null; failed: number; confirmed: number };

// The facts are read once per folder, so every rule reads the same numbers.
const saved = new Map<string, Promise<Facts>>();

async function readFacts(folder: string): Promise<Facts> {
  const rows = await auditRows(folder, incidentIdIn(folder));
  const window = await impactWindow(folder, rows);
  if (!window) return { rows, window, failed: -1, confirmed: -1 };
  const failed = await failedBookings(folder, window);
  return { rows, window, failed, confirmed: confirmedBookings(folder, window) };
}

function facts(folder: string): Promise<Facts> {
  let found = saved.get(folder);
  if (!found) {
    found = readFacts(folder);
    saved.set(folder, found);
  }
  return found;
}

const text = (folder: string) => read(folder, POSTMORTEM);
const impact = (folder: string) => section(text(folder), "Impact");

// Live bookings may land on the edge of the window, so a count may be 2% away.
const near = (count: number, expected: number) =>
  expected >= 0 && Math.abs(count - expected) <= Math.ceil(expected * 0.02);

// The people in the audit log: every actor that is an email, and the name before the @.
function peopleIn(rows: AuditRow[]): string[] {
  const emails = rows.map((row) => row.actor).filter((actor) => actor.includes("@"));
  const names = emails.map((email) => email.split("@")[0]);
  return [...new Set([...emails, ...names])];
}

function blamesNoOne(rootCauses: string, rows: AuditRow[]): boolean {
  if (!rootCauses || EMAIL.test(rootCauses) || BLAME.test(rootCauses)) return false;
  const lower = rootCauses.toLowerCase();
  return peopleIn(rows).every((person) => !lower.includes(person.toLowerCase()));
}

export default [
  {
    says: "the postmortem names an incident that was fixed by an approved change",
    test: async (folder) => {
      const kinds = (await facts(folder)).rows.map((row) => row.kind);
      return kinds.includes("finding_submitted") && kinds.includes("remediation_executed");
    },
    tryNext:
      "put your incident id on the Incident: line; " +
      "bun parts/06-write-it-down/audit-log.ts lists your incidents",
  },
  {
    says: `it has every section: ${SECTIONS.join(", ")}`,
    test: (folder) => SECTIONS.every((heading) => hasHeading(text(folder), heading)),
    tryNext: "keep every ## heading of the starter, with your words under each one",
  },
  {
    says: "Impact gives the window: from the first span of the bad release to the change",
    test: async (folder) => {
      const { window } = await facts(folder);
      if (!window) return false;
      const started = clockAfter(impact(folder), "Impact started");
      const ended = clockAfter(impact(folder), "Impact ended");
      return started === clockOf(window.start) && ended === clockOf(window.end);
    },
    tryNext:
      "write Impact started: and Impact ended: with the two times from the Impact window " +
      "line of audit-log.ts",
  },
  {
    says: "Impact counts the failed bookings, as the traces show them",
    test: async (folder) => {
      const { failed } = await facts(folder);
      return near(numberAfter(impact(folder), "Failed bookings"), failed);
    },
    tryNext: "write Failed bookings: and the number audit-log.ts prints; never round or guess it",
  },
  {
    says: "Impact counts the bookings that went through, as the bookings table shows them",
    test: async (folder) => {
      const { confirmed } = await facts(folder);
      return near(numberAfter(impact(folder), "Bookings confirmed"), confirmed);
    },
    tryNext: "write Bookings confirmed: and the number of rows audit-log.ts prints",
  },
  {
    says: "Trigger names the change: the service and the release",
    test: async (folder) => {
      const change = blamedChange((await facts(folder)).rows);
      const trigger = section(text(folder), "Trigger");
      return !!change && trigger.includes(change.service) && trigger.includes(change.release);
    },
    tryNext:
      "under ## Trigger, name the service and the release, such as release v2 of booking-web",
  },
  {
    says: "Root causes names a cause in the system, never a person",
    test: async (folder) => {
      const rootCauses = section(text(folder), "Root causes");
      return blamesNoOne(rootCauses, (await facts(folder)).rows);
    },
    tryNext:
      "describe what in the system let this happen; take out names, emails and words like " +
      "careless or should have",
  },
  {
    says: "Action items lists at least two things to change",
    test: (folder) => {
      const items = section(text(folder), "Action items").match(/^\s*[-*]\s+\S/gm) ?? [];
      return items.length >= 2;
    },
    tryNext: "under ## Action items, write one line per change, each starting with a dash",
  },
] satisfies Rule[];
