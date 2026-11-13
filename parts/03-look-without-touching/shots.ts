// bun parts/03-look-without-touching/shots.ts: draw the pictures of this part as a dark
// terminal about 800 pixels wide. The tool list needs the world running; the other three
// pictures come from the recorded bad-release morning.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { queryAtMoment, secondsBeforeEnd } from "./replay";

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

async function drawTerminal(title: string, text: string, step: string) {
  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({ viewport: { width: 800, height: 200 } });
  await page.setContent(terminalHtml(title, text));
  const height = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: 800, height });
  const path = join(PART, step, "images", "expected.png");
  await page.screenshot({ path });
  await browser.close();
  console.log(`  wrote ${step}/images/expected.png`);
}

const solutionSql = (step: string, file: string) =>
  readFileSync(join(PART, step, "solution", file), "utf8");

// Rows as a table: one line per row, each column padded to its widest value.
function table(rows: Record<string, unknown>[]): string {
  const columns = Object.keys(rows[0] ?? {});
  const cell = (value: unknown) => String(value);
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => cell(row[column]).length)),
  );
  const line = (values: string[]) =>
    values.map((value, index) => value.padEnd(widths[index])).join("   ");
  const body = rows.map((row) => line(columns.map((column) => cell(row[column]))));
  return [line(columns), ...body].join("\n");
}

async function drawToolList() {
  const listTools = Bun.spawnSync(["bun", join(PART, "list-tools.ts")], { stdout: "pipe" });
  const text = listTools.stdout.toString().trim();
  await drawTerminal(
    "bun parts/03-look-without-touching/list-tools.ts",
    text,
    "01-connect-the-read-tools",
  );
}

async function drawNewPattern() {
  const step = "02-find-the-new-pattern";
  const firstError = "SELECT minIf(Timestamp, StatusCode = 'Error') AS at FROM otel_traces";
  const moment = (await secondsBeforeEnd("bad-release", firstError)) - 60;
  const rows = await queryAtMoment(
    "bad-release",
    moment,
    solutionSql(step, "find-the-new-pattern.sql"),
  );
  // The pattern goes last and is cut short, so each row stays on one line.
  const shortRows = rows.slice(0, 6).map(({ pattern, ...counts }) => ({
    ...counts,
    pattern: String(pattern).slice(0, 40),
  }));
  const title = "find-the-new-pattern.sql, one minute after the first failed booking";
  await drawTerminal(title, table(shortRows), step);
}

async function drawSlowestTrace() {
  const step = "03-open-the-slowest-trace";
  const rows = await queryAtMoment(
    "bad-release",
    0,
    solutionSql(step, "open-the-slowest-trace.sql"),
  );
  await drawTerminal(
    "open-the-slowest-trace.sql on the recorded bad-release morning",
    table(rows),
    step,
  );
}

async function drawReleases() {
  const step = "04-name-the-release";
  const rows = await queryAtMoment("bad-release", 0, solutionSql(step, "name-the-release.sql"));
  const rounded = rows.map((row) => ({
    ...row,
    // biome-ignore lint/style/useNamingConvention: error_rate is a SQL column name.
    error_rate: Number(row.error_rate).toFixed(3),
  }));
  await drawTerminal(
    "name-the-release.sql on the recorded bad-release morning",
    table(rounded),
    step,
  );
}

await drawToolList();
await drawNewPattern();
await drawSlowestTrace();
await drawReleases();
