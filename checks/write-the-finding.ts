// write-the-finding: the learner's AI SRE sends a finding for bad-release through
// submit_finding. The check reads the finding harbour-control stored, never the model's reply,
// and grades it against the fault the course planted.
import {
  type Finding,
  hasFindingId,
  incidentRows,
  plantedCode,
  plantedFault,
  readFinding,
  sameList,
  storedFinding,
  traceIdList,
} from "../parts/04-say-what-broke/evidence";
import type { Rule } from "../scripts/verify";
import { query } from "./lib/world";

const FILE = "findings/bad-release.json";
const SEND = `bun parts/04-say-what-broke/call-tool.ts submit_finding ${FILE}`;
const planted = plantedFault("bad-release");
const plantedChange = `${planted.change.kind} ${planted.change.value}`;

async function stored(folder: string): Promise<Finding | null> {
  const finding = readFinding(folder, FILE);
  if (!hasFindingId(finding)) return null;
  return storedFinding(folder, finding.finding_id as string);
}

function sameAsStored(mine: Finding, saved: Finding): boolean {
  const sameService = mine.service === saved.service;
  const sameChange = JSON.stringify(mine.change) === JSON.stringify(saved.change);
  return sameService && sameChange && sameList(mine.trace_ids, saved.trace_ids);
}

// The verification code is planted in every failing log line of this run, as ref=HX-XXXXXX.
async function quoteHoldsTheCode(folder: string, quote: string): Promise<boolean> {
  const quoted = quote.match(/HX-[A-Z0-9]{6}/)?.[0] ?? "";
  const expected = plantedCode(folder, "bad-release");
  if (expected) return quoted === expected;
  // The fault is healed now, so the code must still be in a failing line of the telemetry.
  const sql =
    "SELECT count() AS lines FROM otel_logs WHERE ServiceName = 'booking-web' " +
    "AND Body LIKE '%connection pool exhausted%' AND position(Body, {code:String}) > 0";
  const rows = await query<{ lines: number }>(folder, sql, { code: quoted || "none" });
  return quoted !== "" && Number(rows[0]?.lines) > 0;
}

// Every cited trace must have a failing booking-web span that began after the incident window
// opened (15 minutes before the page).
async function tracesAreFailingAndInWindow(folder: string, saved: Finding): Promise<boolean> {
  const rows = await incidentRows(folder, saved.incident_id as string);
  if (rows[0]?.kind !== "incident_opened") return false;
  const sql =
    "SELECT TraceId AS id FROM otel_traces " +
    `WHERE TraceId IN (${traceIdList(saved.trace_ids)}) AND ServiceName = 'booking-web' ` +
    "GROUP BY TraceId HAVING countIf(StatusCode = 'Error') > 0 AND min(Timestamp) >= (" +
    "SELECT min(ts) - INTERVAL 15 MINUTE FROM sre.incident_events " +
    "WHERE incident_id = {incident:String} AND kind = 'incident_opened')";
  const failing = await query<{ id: string }>(folder, sql, {
    incident: saved.incident_id as string,
  });
  const cited = saved.trace_ids ?? [];
  return cited.length >= 2 && failing.length === cited.length;
}

export default [
  {
    says: `${FILE} holds the finding_id that submit_finding returned`,
    test: (folder) => hasFindingId(readFinding(folder, FILE)),
    tryNext: `fill in every field, then send it: ${SEND}. It writes the finding_id back`,
  },
  {
    says: "harbour-control stored that finding: a finding_submitted row in the audit log",
    test: async (folder) => (await stored(folder)) !== null,
    tryNext:
      "a finding_id you typed, or one from a refused finding, is not stored. " +
      "Read the REFUSED line, fix the field it names, and send the file again",
  },
  {
    says: "the file says what was stored: the same service, change and trace ids",
    test: async (folder) => {
      const saved = await stored(folder);
      return saved !== null && sameAsStored(readFinding(folder, FILE), saved);
    },
    tryNext: "do not edit the file after you send it. Change it, then send it again",
  },
  {
    says: `it blames the planted fault: ${planted.service}, ${plantedChange}`,
    test: async (folder) => {
      const saved = await stored(folder);
      const sameChange = JSON.stringify(saved?.change) === JSON.stringify(planted.change);
      return saved?.service === planted.service && sameChange;
    },
    tryNext:
      "count errors by release, as in name-the-release. Blame the service whose spans " +
      'fail and the release that brought the errors: {"kind": "release", "value": "v2"}',
  },
  {
    says: "the pattern and the quote name the new error",
    test: async (folder) => {
      const saved = await stored(folder);
      const text = `${saved?.pattern ?? ""} ${saved?.quote ?? ""}`.toLowerCase();
      return planted.pattern.every((words) => text.includes(words));
    },
    tryNext:
      "find the log pattern that is new in the incident window, as in find-the-new-pattern, " +
      "and quote one line of it",
  },
  {
    says: "the quote holds this run's verification code, so it was copied from real telemetry",
    test: async (folder) => quoteHoldsTheCode(folder, (await stored(folder))?.quote ?? ""),
    tryNext:
      "copy one failing log line word for word from search_logs or HyperDX. " +
      "It ends with ref=HX- and six letters",
  },
  {
    says: "every trace id is a failing booking-web request inside the incident window",
    test: async (folder) => {
      const saved = await stored(folder);
      return saved !== null && tracesAreFailingAndInWindow(folder, saved);
    },
    tryNext:
      "cite two or more trace ids of failing bookings from this incident. " +
      "The trace_id of each pool exhausted log line is one",
  },
] satisfies Rule[];
