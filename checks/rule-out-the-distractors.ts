// rule-out-the-distractors: on noisy-morning nothing is broken. The learner's AI SRE must say
// so in a stored finding, name the two signals that look like a cause, and propose nothing.
import {
  type Finding,
  hasFindingId,
  incidentRows,
  readFinding,
  storedFinding,
} from "../parts/04-say-what-broke/evidence";
import type { Rule } from "../scripts/verify";

const FILE = "findings/noisy-morning.json";
const PROBLEM_FOLDER = "parts/04-say-what-broke/03-rule-out-the-distractors/problem";
const CALL_TOOL = "bun parts/04-say-what-broke/call-tool.ts";
const SEND = `${CALL_TOOL} submit_finding ${PROBLEM_FOLDER}/${FILE}`;

async function stored(folder: string): Promise<Finding | null> {
  const finding = readFinding(folder, FILE);
  if (!hasFindingId(finding)) return null;
  return storedFinding(folder, finding.finding_id as string);
}

async function ruledOutSignals(folder: string): Promise<string[]> {
  const saved = await stored(folder);
  const ruledOut = saved?.ruled_out ?? [];
  return ruledOut.map((entry) => String(entry.signal ?? "").toLowerCase());
}

async function incidentKinds(folder: string): Promise<{ kind: string; payload: string }[]> {
  const saved = await stored(folder);
  if (!saved) return [];
  return incidentRows(folder, saved.incident_id as string);
}

export default [
  {
    says: `${FILE} holds the finding_id that submit_finding returned`,
    test: (folder) => hasFindingId(readFinding(folder, FILE)),
    tryNext: `fill in every field, then send it: ${SEND}`,
  },
  {
    says: "harbour-control stored that finding: a finding_submitted row in the audit log",
    test: async (folder) => (await stored(folder)) !== null,
    tryNext: "read the REFUSED line, fix the field it names, and send the file again",
  },
  {
    says: "the finding answers the noisy-morning page from the ops desk",
    test: async (folder) => {
      const rows = await incidentKinds(folder);
      const opened = rows.find((row) => row.kind === "incident_opened");
      return Boolean(opened) && JSON.parse(opened?.payload ?? "{}").rule === "manual_page";
    },
    tryNext:
      "run bun run world break noisy-morning, then use the incident_id of the new " +
      "manual_page incident in Harbour Control",
  },
  {
    says: 'change is {"kind": "none"}: nothing changed, so nothing needs a fix',
    test: async (folder) => (await stored(folder))?.change?.kind === "none",
    tryNext:
      "compare the error rate with the baseline. Nothing moved, so say " +
      '{"kind": "none", "value": ""}',
  },
  {
    says: "ruled_out names the card declines",
    test: async (folder) =>
      (await ruledOutSignals(folder)).some((signal) => signal.includes("card declin")),
    tryNext:
      'add {"signal": "card declined by payments gateway", "why": "..."} with the reason ' +
      "the decline rate tells you",
  },
  {
    says: "ruled_out names the old TLS blip",
    test: async (folder) =>
      (await ruledOutSignals(folder)).some((signal) => signal.includes("tls")),
    tryNext:
      "search booking-web logs for the last 60 minutes. Look for TLS errors, check when they " +
      "stopped, and add them to ruled_out",
  },
  {
    says: "every ruled-out signal says why it is not the cause",
    test: async (folder) => {
      const ruledOut = (await stored(folder))?.ruled_out ?? [];
      return ruledOut.length > 0 && ruledOut.every((entry) => String(entry.why ?? "").trim());
    },
    tryNext: "give each ruled_out entry a why: one short reason taken from the telemetry",
  },
  {
    says: "no change was proposed for this incident",
    test: async (folder) => {
      const rows = await incidentKinds(folder);
      const proposed = rows.filter((row) => row.kind === "remediation_proposed");
      return rows.length > 0 && proposed.length === 0;
    },
    tryNext: "when nothing is broken, propose nothing. Do not call propose_remediation",
  },
] satisfies Rule[];
