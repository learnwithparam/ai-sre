// bun run shots: capture every picture the course shows, from the running world, with
// Playwright's Chromium.
// Pages are real pages. Terminal output is the real output of a command, rendered dark about
// 800 px wide.
// Needs the world up and the finished loop run once (bun run demo bad-release, approve,
// demo finish).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { chQuery } from "../world/lib/clickhouse";
import { env, ROOT } from "../world/lib/env";

const settings = env();
const partOne = join(ROOT, "parts", "01-see-every-signal");
const executablePath = existsSync("/opt/pw-browsers/chromium")
  ? "/opt/pw-browsers/chromium"
  : undefined;
const browser = await chromium.launch({ executablePath });

async function shot(page: Page, path: string) {
  await page.screenshot({ path });
  console.log(`  wrote ${path.replace(`${ROOT}/`, "")}`);
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function newPage(width: number, height: number): Promise<Page> {
  return browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
}

function terminalHtml(title: string, text: string): string {
  const body = "margin:0;background:#0d1117";
  const frame = "padding:16px 18px;font:13px/1.5 ui-monospace,Menlo,monospace;color:#c9d1d9";
  const prompt = `<div style="color:#7ee787">$ ${escapeHtml(title)}</div>`;
  const output = `<pre style="margin:6px 0 0;white-space:pre-wrap">${escapeHtml(text)}</pre>`;
  return `<body style="${body}"><div style="${frame}">\n    ${prompt}${output}</div></body>`;
}

async function terminal(title: string, text: string, path: string) {
  const page = await newPage(800, 200);
  await page.setContent(terminalHtml(title, text));
  await page.setViewportSize({
    width: 800,
    height: await page.evaluate(() => document.body.scrollHeight),
  });
  await shot(page, path);
  await page.close();
}

// The booking page after a booking.
async function shootBookingPage() {
  const page = await newPage(900, 1100);
  await page.goto("http://localhost:8000/");
  await page.selectOption('select[name="sailing_id"]', "2");
  await page.click('button[type="submit"]');
  await page.waitForSelector("#result.ok");
  await page.locator("#book").scrollIntoViewIfNeeded();
  await shot(page, join(ROOT, "00-orientation", "meet-the-harbour", "images", "expected.png"));
  await page.close();
}

// Harbour Control: the resolved incident with its findings and audit trail.
async function shootHarbourControl() {
  const page = await newPage(1280, 1400);
  await page.goto("http://localhost:8090/login");
  await page.fill('input[name="email"]', settings.SRE_APPROVER_EMAIL);
  await page.fill('input[name="password"]', settings.SRE_APPROVER_PASSWORD);
  await page.click('button[type="submit"]');
  const latestResolved = [
    "SELECT incident_id FROM sre.incident_events",
    "WHERE kind = 'verification_passed' ORDER BY ts DESC LIMIT 1",
  ].join(" ");
  // biome-ignore lint/style/useNamingConvention: incident_id is a ClickHouse column name.
  const [row] = await chQuery<{ incident_id: string }>(latestResolved);
  await page.goto(`http://localhost:8090/incidents/${row.incident_id}`);
  await shot(page, join(ROOT, "00-orientation", "images", "finished-loop.png"));
  await shot(page, join(ROOT, "images", "finished-system.png"));
  await page.close();
}

async function signInToHyperdx(page: Page) {
  await page.goto("http://localhost:8080/login");
  await page.fill('input[name="email"]', settings.HYPERDX_USER_EMAIL);
  await page.fill('input[type="password"]', settings.HYPERDX_USER_PASSWORD);
  await page.keyboard.press("Enter");
  await page.waitForURL(/search/);
}

type Source = { kind: string; id?: string; _id?: string };

// Searches the trace source and opens the second row, which shows a full waterfall.
async function openTrace(page: Page, traces: Source, where: string) {
  const query = `source=${traces.id ?? traces._id}&where=${encodeURIComponent(where)}`;
  await page.goto(`http://localhost:8080/search?${query}&whereLanguage=lucene`);
  await page.waitForTimeout(4000);
  await page.locator("table tbody tr").nth(1).click();
  await page.waitForTimeout(4000);
}

// HyperDX: the check-in trace, its waterfall and the release on the span.
async function shootHyperdx() {
  const page = await newPage(1400, 900);
  await signInToHyperdx(page);
  const response = await page.request.get("http://localhost:8080/api/sources");
  const sources: Source[] = await response.json();
  const traces = sources.find((source) => source.kind === "trace") as Source;
  await openTrace(page, traces, 'SpanName:"POST /api/checkin"');
  await shot(page, join(partOne, "03-add-the-checkin-span", "images", "expected.png"));
  await openTrace(page, traces, 'SpanName:"POST /api/bookings"');
  await page.getByText("Resource Attributes", { exact: true }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await shot(page, join(partOne, "02-tag-the-release", "images", "expected.png"));
  await page.close();
}

// biome-ignore lint/style/useNamingConvention: error_spans is a SQL column name.
type ServiceRow = { service: string; spans: string; error_spans: string };

function serviceTable(rows: ServiceRow[]): string {
  const lines = rows.map((row) => {
    const spans = String(row.spans).padStart(6);
    const errorSpans = String(row.error_spans).padStart(11);
    return `${row.service.padEnd(18)} ${spans}   ${errorSpans}`;
  });
  return ["service            spans   error_spans", ...lines].join("\n");
}

// The list-the-services answer on the live world, as the terminal shows it.
async function shootServiceList() {
  const sql = [
    "SELECT ServiceName AS service, count() AS spans,",
    "countIf(StatusCode = 'Error') AS error_spans FROM otel_traces",
    "WHERE Timestamp > now() - INTERVAL 60 MINUTE GROUP BY service ORDER BY spans DESC",
  ].join(" ");
  const rows = await chQuery<ServiceRow>(sql);
  const readableSql = sql.replace(/ (FROM|WHERE|GROUP|ORDER)/g, "\n$1");
  await terminal(
    "list-the-services.sql in HyperDX's SQL view, or: clickhouse client",
    `${readableSql}\n\n${serviceTable(rows)}`,
    join(partOne, "01-list-the-services", "images", "expected.png"),
  );
}

await shootBookingPage();
await shootHarbourControl();
await shootHyperdx();
await shootServiceList();
await browser.close();
console.log("Every picture was captured from the running world.");
