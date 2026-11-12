// bun run demo bad-release   plant the fault, wait for the page, let the AI SRE investigate and propose
// bun run demo finish        after a human approved: the AI SRE runs the change, harbour-control verifies it
import { chQuery } from "../world/lib/clickhouse";
import { env } from "../world/lib/env";
import { provider } from "../config/models";
import { runAiSre } from "./ai-sre";

const [what = "bad-release"] = process.argv.slice(2);
const say = (s: string) => console.log(s);

async function openIncident(since: string): Promise<string | null> {
  const rows = await chQuery<{ incident_id: string }>(
    "SELECT incident_id FROM sre.incident_events WHERE kind = 'incident_opened' AND ts >= parseDateTime64BestEffort({since:String}) ORDER BY ts DESC LIMIT 1",
    { since },
  );
  return rows[0]?.incident_id ?? null;
}

async function events(incident: string) {
  return chQuery<{ kind: string; actor: string }>(
    "SELECT kind, actor FROM sre.incident_events WHERE incident_id = {id:String} ORDER BY ts", { id: incident },
  );
}

if (what === "finish") {
  const open = await chQuery<{ incident_id: string }>(
    "SELECT incident_id FROM sre.incident_events GROUP BY incident_id HAVING countIf(kind='incident_opened')=1 AND countIf(kind='incident_resolved')=0 AND countIf(kind='remediation_approved')>0 ORDER BY max(ts) DESC LIMIT 1",
  );
  if (!open.length) { say("No open incident has an approved change. Approve one first: bun run approve"); process.exit(1); }
  say(`AI SRE (${provider()} mode) runs the approved change for ${open[0].incident_id}:`);
  await runAiSre(`A human approved the change for incident ${open[0].incident_id}. Run it.`, "execute");
  say("\nWaiting for harbour-control to verify recovery on fresh traffic (about 90 seconds)...");
  const until = Date.now() + 240_000;
  while (Date.now() < until) {
    const kinds = (await events(open[0].incident_id)).map((e) => e.kind);
    if (kinds.includes("incident_resolved")) {
      const footer = await fetch("http://localhost:8000/").then((r) => r.text()).then((t) => t.match(/Release (v\d)/)?.[1]);
      say(`  audit log: ${kinds.join(", ")}`);
      say(`  booking page footer: Release ${footer}`);
      say("Resolved: the change was approved by a human, ran once, and recovery was verified.");
      process.exit(0);
    }
    await Bun.sleep(5000);
  }
  say("Recovery was not verified within 4 minutes. Open http://localhost:8090 to see the verification result.");
  process.exit(1);
}

if (what !== "bad-release") { say("Try: bun run demo bad-release, then bun run approve, then bun run demo finish"); process.exit(1); }
const since = new Date(Date.now() - 2000).toISOString();
const plant = Bun.spawnSync(["bun", "scripts/world.ts", "break", "bad-release"], { stdout: "inherit", stderr: "inherit" });
if (plant.exitCode !== 0) process.exit(2);
say("Waiting for harbour-control's detector to page (up to 3 minutes)...");
let incident: string | null = null;
for (const until = Date.now() + 180_000; Date.now() < until && !incident; await Bun.sleep(5000)) incident = await openIncident(since);
if (!incident) { say("No incident opened. Check bun run world status and open http://localhost:8090."); process.exit(1); }
say(`Incident ${incident} is open. The AI SRE (${provider()} mode) investigates:`);
await runAiSre(`Investigate incident ${incident}. Find the cause, prove it, and propose one change.`, "bad-release");
const kinds = (await events(incident)).map((e) => e.kind);
say(`\n  audit log: ${kinds.join(", ")}`);
const action = await chQuery<{ action_id: string }>("SELECT action_id FROM sre.incident_events WHERE incident_id={id:String} AND kind='remediation_proposed' LIMIT 1", { id: incident });
say(`Waiting for a human: approve at ${env().SRE_PUBLIC_URL || "http://localhost:8090"}/actions/${action[0]?.action_id ?? "?"} or run bun run approve`);
