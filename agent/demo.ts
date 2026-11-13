// bun run demo bad-release   plant the fault, wait for the page, let the AI SRE investigate and
//                            propose a change
// bun run demo finish        after a human approved: the AI SRE runs the change, and
//                            harbour-control verifies it

import { provider } from "../config/models";
import { chQuery } from "../world/lib/clickhouse";
import { env } from "../world/lib/env";
import { runAiSre } from "./ai-sre";

const [what = "bad-release"] = process.argv.slice(2);
const say = (line: string) => console.log(line);
const harbourControlUrl = () => env().SRE_PUBLIC_URL || "http://localhost:8090";

// ClickHouse returns snake_case column names, so the row types keep them.
// biome-ignore-start lint/style/useNamingConvention: these are ClickHouse column names.
type IncidentRow = { incident_id: string };
type ActionRow = { action_id: string };
// biome-ignore-end lint/style/useNamingConvention: these are ClickHouse column names.

const NEWEST_OPENED_INCIDENT =
  "SELECT incident_id FROM sre.incident_events WHERE kind = 'incident_opened' " +
  "AND ts >= parseDateTime64BestEffort({since:String}) ORDER BY ts DESC LIMIT 1";

const OPEN_APPROVED_INCIDENT =
  "SELECT incident_id FROM sre.incident_events GROUP BY incident_id " +
  "HAVING countIf(kind='incident_opened')=1 AND countIf(kind='incident_resolved')=0 " +
  "AND countIf(kind='remediation_approved')>0 ORDER BY max(ts) DESC LIMIT 1";

const PROPOSED_ACTION =
  "SELECT action_id FROM sre.incident_events WHERE incident_id={id:String} " +
  "AND kind='remediation_proposed' LIMIT 1";

async function openIncident(since: string): Promise<string | null> {
  const rows = await chQuery<IncidentRow>(NEWEST_OPENED_INCIDENT, { since });
  return rows[0]?.incident_id ?? null;
}

async function eventKinds(incident: string): Promise<string[]> {
  const events = await chQuery<{ kind: string; actor: string }>(
    "SELECT kind, actor FROM sre.incident_events WHERE incident_id = {id:String} ORDER BY ts",
    { id: incident },
  );
  return events.map((event) => event.kind);
}

async function bookingPageRelease(): Promise<string | undefined> {
  const response = await fetch("http://localhost:8000/");
  const page = await response.text();
  return page.match(/Release (v\d)/)?.[1];
}

// Wait up to 4 minutes for harbour-control to resolve the incident. Returns true when it did.
async function waitForRecovery(incident: string): Promise<boolean> {
  const until = Date.now() + 240_000;
  while (Date.now() < until) {
    const kinds = await eventKinds(incident);
    if (kinds.includes("incident_resolved")) {
      const footer = await bookingPageRelease();
      say(`  audit log: ${kinds.join(", ")}`);
      say(`  booking page footer: Release ${footer}`);
      return true;
    }
    await Bun.sleep(5000);
  }
  return false;
}

async function finish(): Promise<never> {
  const open = await chQuery<IncidentRow>(OPEN_APPROVED_INCIDENT);
  if (!open.length) {
    say("No open incident has an approved change. Approve one first: bun run approve");
    process.exit(1);
  }
  const incident = open[0].incident_id;
  say(`AI SRE (${provider()} mode) runs the approved change for ${incident}:`);
  await runAiSre(`A human approved the change for incident ${incident}. Run it.`, "execute");
  say("\nWaiting for harbour-control to verify recovery on fresh traffic (about 90 seconds)...");
  if (await waitForRecovery(incident)) {
    say("Resolved: the change was approved by a human, ran once, and recovery was verified.");
    process.exit(0);
  }
  say(
    "Recovery was not verified within 4 minutes. " +
      "Open http://localhost:8090 to see the verification result.",
  );
  process.exit(1);
}

// Poll every 5 seconds, for up to 3 minutes, for an incident opened after `since`.
async function waitForIncident(since: string): Promise<string | null> {
  let incident: string | null = null;
  const until = Date.now() + 180_000;
  while (Date.now() < until && !incident) {
    incident = await openIncident(since);
    await Bun.sleep(5000);
  }
  return incident;
}

async function badRelease(): Promise<void> {
  const since = new Date(Date.now() - 2000).toISOString();
  const plant = Bun.spawnSync(["bun", "scripts/world.ts", "break", "bad-release"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (plant.exitCode !== 0) process.exit(2);
  say("Waiting for harbour-control's detector to page (up to 3 minutes)...");
  const incident = await waitForIncident(since);
  if (!incident) {
    say("No incident opened. Check bun run world status and open http://localhost:8090.");
    process.exit(1);
  }
  say(`Incident ${incident} is open. The AI SRE (${provider()} mode) investigates:`);
  await runAiSre(
    `Investigate incident ${incident}. Find the cause, prove it, and propose one change.`,
    "bad-release",
  );
  say(`\n  audit log: ${(await eventKinds(incident)).join(", ")}`);
  const action = await chQuery<ActionRow>(PROPOSED_ACTION, { id: incident });
  const actionId = action[0]?.action_id ?? "?";
  say(
    `Waiting for a human: approve at ${harbourControlUrl()}/actions/${actionId} ` +
      "or run bun run approve",
  );
}

if (what === "finish") await finish();
if (what !== "bad-release") {
  say("Try: bun run demo bad-release, then bun run approve, then bun run demo finish");
  process.exit(1);
}
await badRelease();
