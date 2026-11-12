// bun run shots: capture every picture the course shows, from the running world, with Playwright's Chromium.
// Pages are real pages. Terminal output is the real output of a command, rendered dark about 800 px wide.
// Needs the world up and the finished loop run once (bun run demo bad-release, approve, demo finish).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { chQuery } from "../world/lib/clickhouse";
import { ROOT, env } from "../world/lib/env";

const e = env();
const P1 = join(ROOT, "parts", "01-see-every-signal");
const executablePath = existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const browser = await chromium.launch({ executablePath });
const shot = async (page: Page, path: string) => { await page.screenshot({ path }); console.log(`  wrote ${path.replace(ROOT + "/", "")}`); };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

async function terminal(title: string, text: string, path: string) {
  const page = await browser.newPage({ viewport: { width: 800, height: 200 }, deviceScaleFactor: 2 });
  await page.setContent(`<body style="margin:0;background:#0d1117"><div style="padding:16px 18px;font:13px/1.5 ui-monospace,Menlo,monospace;color:#c9d1d9">
    <div style="color:#7ee787">$ ${esc(title)}</div><pre style="margin:6px 0 0;white-space:pre-wrap">${esc(text)}</pre></div></body>`);
  await page.setViewportSize({ width: 800, height: await page.evaluate(() => document.body.scrollHeight) });
  await shot(page, path);
  await page.close();
}

// The booking page after a booking.
{
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 });
  await page.goto("http://localhost:8000/");
  await page.selectOption('select[name="sailing_id"]', "2");
  await page.click('button[type="submit"]');
  await page.waitForSelector("#result.ok");
  await page.locator("#book").scrollIntoViewIfNeeded();
  await shot(page, join(ROOT, "00-orientation", "meet-the-harbour", "images", "expected.png"));
  await page.close();
}

// Harbour Control: the resolved incident with its findings and audit trail.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 2 });
  await page.goto("http://localhost:8090/login");
  await page.fill('input[name="email"]', e.SRE_APPROVER_EMAIL);
  await page.fill('input[name="password"]', e.SRE_APPROVER_PASSWORD);
  await page.click('button[type="submit"]');
  const [row] = await chQuery<{ incident_id: string }>("SELECT incident_id FROM sre.incident_events WHERE kind = 'verification_passed' ORDER BY ts DESC LIMIT 1");
  await page.goto(`http://localhost:8090/incidents/${row.incident_id}`);
  await shot(page, join(ROOT, "00-orientation", "images", "finished-loop.png"));
  await shot(page, join(ROOT, "images", "finished-system.png"));
  await page.close();
}

// HyperDX: the check-in trace, its waterfall and the release on the span.
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await page.goto("http://localhost:8080/login");
  await page.fill('input[name="email"]', e.HYPERDX_USER_EMAIL);
  await page.fill('input[type="password"]', e.HYPERDX_USER_PASSWORD);
  await page.keyboard.press("Enter");
  await page.waitForURL(/search/);
  const sources = await (await page.request.get("http://localhost:8080/api/sources")).json();
  const traces = sources.find((s: { kind: string }) => s.kind === "trace");
  const open = async (where: string) => {
    await page.goto(`http://localhost:8080/search?source=${traces.id ?? traces._id}&where=${encodeURIComponent(where)}&whereLanguage=lucene`);
    await page.waitForTimeout(4000);
    await page.locator("table tbody tr").nth(1).click();
    await page.waitForTimeout(4000);
  };
  await open('SpanName:"POST /api/checkin"');
  await shot(page, join(P1, "03-add-the-checkin-span", "images", "expected.png"));
  await open('SpanName:"POST /api/bookings"');
  await page.getByText("Resource Attributes", { exact: true }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await shot(page, join(P1, "02-tag-the-release", "images", "expected.png"));
  await page.close();
}

// The list-the-services answer on the live world, as the terminal shows it.
{
  const sql = "SELECT ServiceName AS service, count() AS spans, countIf(StatusCode = 'Error') AS error_spans FROM otel_traces WHERE Timestamp > now() - INTERVAL 60 MINUTE GROUP BY service ORDER BY spans DESC";
  const rows = await chQuery<{ service: string; spans: string; error_spans: string }>(sql);
  const table = ["service            spans   error_spans", ...rows.map((r) => `${r.service.padEnd(18)} ${String(r.spans).padStart(6)}   ${String(r.error_spans).padStart(11)}`)].join("\n");
  await terminal("list-the-services.sql in HyperDX's SQL view, or: clickhouse client", `${sql.replace(/ (FROM|WHERE|GROUP|ORDER)/g, "\n$1")}\n\n${table}`, join(P1, "01-list-the-services", "images", "expected.png"));
}

await browser.close();
console.log("Every picture was captured from the running world.");
