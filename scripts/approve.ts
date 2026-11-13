// bun run approve           show the waiting change, its evidence and blast radius
// bun run approve --yes     approve it as the on-call human named in .env (SRE_APPROVER_EMAIL)
// This is you, the human, deciding. The AI SRE has no way to call it.
import { env } from "../world/lib/env";

const settings = env();
const base = settings.SRE_PUBLIC_URL || "http://localhost:8090";
const yes = process.argv.includes("--yes");

async function signIn(): Promise<string | undefined> {
  const login = await fetch(`${base}/login`, {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({
      email: settings.SRE_APPROVER_EMAIL,
      password: settings.SRE_APPROVER_PASSWORD,
      next: "/",
    }),
  });
  return login.headers.get("set-cookie")?.split(";")[0];
}

async function fetchPage(path: string, cookie: string): Promise<string> {
  const response = await fetch(`${base}${path}`, { headers: { cookie } });
  return response.text();
}

function firstCaptures(page: string, pattern: RegExp): string[] {
  return [...page.matchAll(pattern)].map((match) => match[1]);
}

// Pulls one piece of text out of the action page and turns its HTML into plain words.
function plainText(html: string, pattern: RegExp): string {
  const captured = html.match(pattern)?.[1] ?? "";
  const withoutTags = captured.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
  return withoutTags.replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
}

function printAction(actionId: string, incidentId: string, html: string) {
  const hypothesis = plainText(html, /Root cause, in the agent's words<\/h2>\s*<p>([\s\S]*?)<\/p>/);
  const title = plainText(html, /<h1>([\s\S]*?)<\/h1>/);
  const chip = plainText(html, /<span class="chip">([\s\S]*?)<\/span>/);
  const blastRadius = plainText(html, /<h2>Blast radius<\/h2>\s*<p>([\s\S]*?)<\/p>/);
  console.log(`Waiting change ${actionId} for ${incidentId}`);
  console.log(`  hypothesis:   ${hypothesis}`);
  console.log(`  change:       ${title} ${chip}`);
  console.log(`  blast radius: ${blastRadius}`);
}

const cookie = await signIn();
if (!cookie) {
  console.log("Could not sign in to Harbour Control. Is the world up? Run bun run world status.");
  process.exit(2);
}
const home = await fetchPage("/", cookie);
const incidents = firstCaptures(home, /href="\/incidents\/(inc-[0-9a-f]+)"/g);
const pendingAction = /data-state="pending"[\s\S]*?href="\/actions\/(act-[0-9a-f]+)"/g;
for (const incidentId of incidents) {
  const page = await fetchPage(`/incidents/${incidentId}`, cookie);
  const pending = firstCaptures(page, pendingAction);
  if (!pending.length) continue;
  const id = pending[0];
  printAction(id, incidentId, await fetchPage(`/actions/${id}`, cookie));
  if (!yes) {
    const actionUrl = `${base}/actions/${id}`;
    console.log(
      `Read the evidence at ${actionUrl}, then run bun run approve --yes or click Approve.`,
    );
    process.exit(0);
  }
  await fetch(`${base}/actions/${id}/approve`, {
    method: "POST",
    headers: { cookie },
    redirect: "manual",
  });
  console.log(`Approved ${id} as ${settings.SRE_APPROVER_EMAIL}. Now run bun run demo finish.`);
  process.exit(0);
}
console.log("Nothing is waiting for approval.");
