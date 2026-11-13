// bun parts/07-prove-the-ai-sre-right/run-evals.ts <step-name> [label] [--runs 3]
//   For each world incident in evals/incidents: plant it, wait for the page, run the command
//   that evals/agent.toml names for the label (baseline unless you name another), save the
//   incident's audit rows as evals/runs/<label>/<case>/run-N.json, and heal the world.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findStep, ROOT } from "../../scripts/structure";
import { chQuery } from "../../world/lib/clickhouse";
import { env } from "../../world/lib/env";
import { caseNames, readJson, WORLD_SCENARIOS } from "./incident-set";
import { type Event, RUNS_PER_CASE, runsFolder } from "./scorer";

const say = (line: string) => console.log(line);

// biome-ignore lint/style/useNamingConvention: the audit log keeps snake_case column names.
type Row = Omit<Event, "payload"> & { incident_id: string; payload: string };

function world(...words: string[]): void {
  const result = Bun.spawnSync(["bun", "scripts/world.ts", ...words], { cwd: ROOT });
  if (result.exitCode !== 0) throw new Error(`bun run world ${words.join(" ")} failed`);
}

export function agentCommand(folder: string, label: string): string {
  const path = join(folder, "evals", "agent.toml");
  if (!existsSync(path)) return "";
  const parsed = Bun.TOML.parse(readFileSync(path, "utf8")) as Record<string, { command?: string }>;
  return String(parsed[label]?.command ?? "").trim();
}

async function newestIncident(since: string): Promise<string> {
  const rows = await chQuery<Row>(
    "SELECT incident_id FROM sre.incident_events WHERE kind = 'incident_opened' " +
      "AND ts >= parseDateTime64BestEffort({since:String}) ORDER BY ts DESC LIMIT 1",
    { since },
  );
  return rows[0]?.incident_id ?? "";
}

// Some incidents never trip the detector, so on-call pages by hand, as a person would.
async function pageByHand(caseName: string): Promise<void> {
  const page = { service: "booking-web", summary: `On-call asked for a look (${caseName})` };
  await fetch("http://localhost:8090/api/incidents", {
    method: "POST",
    headers: { authorization: `Bearer ${env().SRE_MCP_TOKEN}`, "content-type": "application/json" },
    // biome-ignore lint/style/useNamingConvention: harbour-control reads this snake_case field.
    body: JSON.stringify({ ...page, paged_by: "eval runner" }),
  });
}

async function waitForIncident(caseName: string, since: string): Promise<string> {
  const until = Date.now() + 150_000;
  while (Date.now() < until) {
    const incident = await newestIncident(since);
    if (incident) return incident;
    if (Date.now() > until - 30_000) await pageByHand(caseName);
    await Bun.sleep(5000);
  }
  throw new Error(`no incident opened for ${caseName}`);
}

async function auditEvents(incidentId: string): Promise<Event[]> {
  const rows = await chQuery<Row>(
    "SELECT toString(ts, 'UTC') AS ts, kind, actor, action_id, payload FROM sre.incident_events " +
      "WHERE incident_id = {id:String} ORDER BY ts",
    { id: incidentId },
  );
  return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload || "{}") }));
}

async function runOnce(folder: string, label: string, caseName: string, runNumber: number) {
  const since = new Date().toISOString();
  world("heal");
  world("break", caseName);
  const incidentId = await waitForIncident(caseName, since);
  say(`  ${caseName} run ${runNumber}: incident ${incidentId}, running your AI SRE...`);
  const command = agentCommand(folder, label);
  // The agent runs from the repo root. STEP_FOLDER lets it find files that agent.toml names
  // from this step folder, such as evals/challenger-prompt.md.
  Bun.spawnSync(["sh", "-c", command], {
    cwd: ROOT,
    // biome-ignore lint/style/useNamingConvention: environment variables are upper case.
    env: { ...process.env, INCIDENT_ID: incidentId, SCENARIO: caseName, STEP_FOLDER: folder },
    stdout: "inherit",
    stderr: "inherit",
    timeout: 300_000,
  });
  const state = readJson<{ code?: string }>(join(ROOT, "world", ".state", "scenario.json"));
  const events = await auditEvents(incidentId);
  // biome-ignore lint/style/useNamingConvention: run files keep the audit log's snake_case.
  const run = { case: caseName, incident_id: incidentId, code: state?.code ?? "", events };
  const caseFolder = join(runsFolder(folder, label), caseName);
  mkdirSync(caseFolder, { recursive: true });
  writeFileSync(join(caseFolder, `run-${runNumber}.json`), `${JSON.stringify(run, null, 2)}\n`);
  world("heal");
}

if (import.meta.main) {
  const words = process.argv.slice(2);
  const step = findStep(words[0] ?? "");
  const label = words[1] && !words[1].startsWith("--") ? words[1] : "baseline";
  const runsAt = words.indexOf("--runs");
  const runs = runsAt >= 0 ? Number(words[runsAt + 1]) : RUNS_PER_CASE;
  if (!step) {
    say("Name a step: bun parts/07-prove-the-ai-sre-right/run-evals.ts score-the-ai-sre");
    process.exit(1);
  }
  const folder = join(step.dir, "problem");
  if (!agentCommand(folder, label)) {
    say(`evals/agent.toml has no command under [${label}]. Add one first.`);
    process.exit(1);
  }
  const cases = caseNames(folder).filter((name) => WORLD_SCENARIOS.includes(name));
  for (const caseName of cases) {
    for (let runNumber = 1; runNumber <= runs; runNumber++)
      await runOnce(folder, label, caseName, runNumber);
  }
  say(`Saved ${cases.length * runs} runs under evals/runs/${label}. Score them with score.ts.`);
}
