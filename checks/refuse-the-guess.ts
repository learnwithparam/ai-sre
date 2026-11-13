// refuse-the-guess: the learner sends, on purpose, a finding with one made-up trace id. The
// check reads harbour-control's audit log: the guess must be refused, for the made-up id, and
// never stored.
import {
  type AuditRow,
  readFinding,
  sameList,
  tracesThatExist,
} from "../parts/04-say-what-broke/evidence";
import type { Rule } from "../scripts/verify";
import { query } from "./lib/world";

const FILE = "findings/guess.json";
const PROBLEM_FOLDER = "parts/04-say-what-broke/02-refuse-the-guess/problem";
const CALL_TOOL = "bun parts/04-say-what-broke/call-tool.ts";
const SEND = `${CALL_TOOL} submit_finding ${PROBLEM_FOLDER}/${FILE}`;

const traceIds = (folder: string) => readFinding(folder, FILE).trace_ids ?? [];

async function madeUpIds(folder: string): Promise<string[]> {
  const cited = traceIds(folder);
  const real = await tracesThatExist(folder, cited);
  return cited.filter((traceId) => !real.includes(traceId));
}

// Every finding row, refused or stored, whose trace ids are exactly the ones in the file.
async function rowsForTheGuess(folder: string, kind: string): Promise<AuditRow[]> {
  const sql =
    "SELECT incident_id, action_id, kind, payload FROM sre.incident_events " +
    "WHERE kind = {kind:String} ORDER BY ts";
  const rows = await query<AuditRow>(folder, sql, { kind });
  const cited = traceIds(folder);
  return rows.filter((row) => sameList(JSON.parse(row.payload).trace_ids, cited));
}

async function refusalReasons(folder: string): Promise<string[]> {
  const refused = await rowsForTheGuess(folder, "finding_refused");
  return refused.map((row) => String(JSON.parse(row.payload).reason ?? ""));
}

export default [
  {
    says: `${FILE} is a finding with at least two trace ids`,
    test: (folder) => {
      const guess = readFinding(folder, FILE);
      return Boolean(guess.incident_id) && traceIds(folder).length >= 2;
    },
    tryNext:
      "copy your finding from write-the-finding into this file. " +
      "Keep the incident_id and two or more trace ids",
  },
  {
    says: "exactly one trace id is made up: it has no spans or logs, and the others are real",
    test: async (folder) => (await madeUpIds(folder)).length === 1,
    tryNext:
      "change one trace id to 32 letters and digits (0-9, a-f) that no request ever had. " +
      "Keep the other ids as they are",
  },
  {
    says: "harbour-control refused the guess and wrote a finding_refused row",
    test: async (folder) => (await rowsForTheGuess(folder, "finding_refused")).length > 0,
    tryNext: `send it: ${SEND}. You should see a REFUSED line`,
  },
  {
    says: "the refusal names your made-up trace id as the reason",
    test: async (folder) => {
      const [madeUp] = await madeUpIds(folder);
      const reasons = await refusalReasons(folder);
      return Boolean(madeUp) && reasons.some((reason) => reason.includes(madeUp));
    },
    tryNext:
      "make the made-up id the only thing wrong. A guess with one trace id is refused " +
      "for its shape, before harbour-control looks at the evidence",
  },
  {
    says: "the guess was never stored as a finding",
    test: async (folder) =>
      traceIds(folder).length > 0 &&
      (await rowsForTheGuess(folder, "finding_submitted")).length === 0,
    tryNext:
      "a stored finding means every trace id was real. Make one id up, then send the file again",
  },
] satisfies Rule[];
