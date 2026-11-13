// bun parts/02-know-when-it-is-broken/shots.ts: draw the pictures of this part from the
// recordings, as a dark terminal about 800 pixels wide. No world needs to run.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { isPaging, type Moment, queryAtMoment, replayRule } from "./replay";

const PART = import.meta.dir;
const executablePath = existsSync("/opt/pw-browsers/chromium")
  ? "/opt/pw-browsers/chromium"
  : undefined;

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function terminalHtml(title: string, text: string): string {
  const body = "margin:0;background:#0d1117";
  const frame = "padding:16px 18px;font:13px/1.5 ui-monospace,Menlo,monospace;color:#c9d1d9";
  const prompt = `<div style="color:#7ee787">$ ${escapeHtml(title)}</div>`;
  const output = `<pre style="margin:6px 0 0;white-space:pre-wrap">${escapeHtml(text)}</pre>`;
  return `<body style="${body}"><div style="${frame}">${prompt}${output}</div></body>`;
}

async function drawTerminal(title: string, text: string, path: string) {
  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({ viewport: { width: 800, height: 200 } });
  await page.setContent(terminalHtml(title, text));
  const height = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: 800, height });
  await page.screenshot({ path });
  await browser.close();
  console.log(`  wrote ${path.replace(`${PART}/`, "")}`);
}

const readSql = (step: string, file: string) =>
  readFileSync(join(PART, step, "solution", file), "utf8");

// biome-ignore lint/style/useNamingConvention: error_rate is a SQL column name.
type BucketRow = { bucket: string; requests: number; errors: number; error_rate: number };

function bucketLine(row: BucketRow): string {
  const time = String(row.bucket).slice(11, 19);
  const requests = String(row.requests).padStart(8);
  const errors = String(row.errors).padStart(8);
  const rate = Number(row.error_rate).toFixed(3).padStart(12);
  return `${time}  ${requests}  ${errors}  ${rate}`;
}

async function drawErrorRate() {
  const sql = readSql("01-chart-the-error-rate", "chart-the-error-rate.sql");
  const rows = await queryAtMoment<BucketRow>("bad-release", 0, sql);
  const fromTheRelease = rows.slice(3, 33);
  const header = "bucket    requests    errors    error_rate";
  const text = [header, ...fromTheRelease.map(bucketLine), "..."].join("\n");
  const path = join(PART, "01-chart-the-error-rate", "images", "expected.png");
  await drawTerminal("chart-the-error-rate.sql on the recorded bad-release morning", text, path);
}

function timelineLine(name: string, timeline: Moment[]): string {
  const marks = timeline.map((moment) => (isPaging(moment, "page") ? "P" : ".")).join("");
  // No page count here: counting the pages is the learner's job in this step.
  return `${name.padEnd(15)} ${marks}`;
}

async function replayLines(sql: string): Promise<string[]> {
  const badRelease = await replayRule("bad-release", sql);
  const noisyMorning = await replayRule("noisy-morning", sql);
  return [timelineLine("bad-release", badRelease), timelineLine("noisy-morning", noisyMorning)];
}

async function drawPages() {
  const step = "04-count-the-pages";
  const oldAlert = await replayLines(readSql(step, "old-alert.sql"));
  const myRule = await replayLines(readSql(step, "my-rule.sql"));
  const text = ["old-alert.sql", ...oldAlert, "", "my-rule.sql", ...myRule].join("\n");
  const path = join(PART, step, "images", "expected.png");
  await drawTerminal("replay-rule.ts, one check every 30 seconds", text, path);
}

await drawErrorRate();
await drawPages();
