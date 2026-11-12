// bun run approve           show the waiting change, its evidence and blast radius
// bun run approve --yes     approve it as the on-call human named in .env (SRE_APPROVER_EMAIL)
// This is you, the human, deciding. The AI SRE has no way to call it.
import { env } from "../world/lib/env";

const e = env();
const base = e.SRE_PUBLIC_URL || "http://localhost:8090";
const yes = process.argv.includes("--yes");
const login = await fetch(`${base}/login`, {
  method: "POST", redirect: "manual",
  body: new URLSearchParams({ email: e.SRE_APPROVER_EMAIL, password: e.SRE_APPROVER_PASSWORD, next: "/" }),
});
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie) { console.log("Could not sign in to Harbour Control. Is the world up? Run bun run world status."); process.exit(2); }
const home = await (await fetch(`${base}/`, { headers: { cookie } })).text();
const incidents = [...home.matchAll(/href="\/incidents\/(inc-[0-9a-f]+)"/g)].map((m) => m[1]);
for (const inc of incidents) {
  const page = await (await fetch(`${base}/incidents/${inc}`, { headers: { cookie } })).text();
  const pending = [...page.matchAll(/data-state="pending"[\s\S]*?href="\/actions\/(act-[0-9a-f]+)"/g)].map((m) => m[1]);
  if (!pending.length) continue;
  const id = pending[0];
  const action = await (await fetch(`${base}/actions/${id}`, { headers: { cookie } })).text();
  const text = (re: RegExp) => (action.match(re)?.[1] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
  console.log(`Waiting change ${id} for ${inc}`);
  console.log(`  hypothesis:   ${text(/Root cause, in the agent's words<\/h2>\s*<p>([\s\S]*?)<\/p>/)}`);
  console.log(`  change:       ${text(/<h1>([\s\S]*?)<\/h1>/)} ${text(/<span class="chip">([\s\S]*?)<\/span>/)}`);
  console.log(`  blast radius: ${text(/<h2>Blast radius<\/h2>\s*<p>([\s\S]*?)<\/p>/)}`);
  if (!yes) { console.log(`Read the evidence at ${base}/actions/${id}, then run bun run approve --yes or click Approve.`); process.exit(0); }
  await fetch(`${base}/actions/${id}/approve`, { method: "POST", headers: { cookie }, redirect: "manual" });
  console.log(`Approved ${id} as ${e.SRE_APPROVER_EMAIL}. Now run bun run demo finish.`);
  process.exit(0);
}
console.log("Nothing is waiting for approval.");
