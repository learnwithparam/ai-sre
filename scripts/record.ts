// bun run record <name> [minutes]   save the last N minutes of the live world (default 25)
// to world/recordings/<name>/
// A recording holds traces, logs, the audit log and the bookings table. Checks read it in CI,
// where no Docker runs, and a recording plays back with its timestamps moved so it ends at
// the moment you query it.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENV_PATH, env, ROOT } from "../world/lib/env";

const [name, minutes = "25"] = process.argv.slice(2);
if (!name) {
  console.log("Name the recording: bun run record bad-release");
  process.exit(1);
}
const out = join(ROOT, "world", "recordings", name);
mkdirSync(out, { recursive: true });
const settings = env();

async function native(sql: string): Promise<Uint8Array> {
  const url = new URL(settings.CLICKHOUSE_URL ?? "http://localhost:8123/");
  const response = await fetch(url, {
    method: "POST",
    body: `${sql} FORMAT Native`,
    headers: {
      "X-ClickHouse-User": "sre_agent",
      "X-ClickHouse-Key": settings.CLICKHOUSE_READER_PASSWORD,
    },
  });
  if (!response.ok) throw new Error((await response.text()).slice(0, 300));
  return new Uint8Array(await response.arrayBuffer());
}

const window = `Timestamp > now() - INTERVAL ${Number(minutes)} MINUTE`;
const tables: [string, string][] = [
  [
    "otel_traces",
    `SELECT * FROM default.otel_traces WHERE ${window} AND ServiceName != 'harbour-control'`,
  ],
  ["otel_logs", `SELECT * FROM default.otel_logs WHERE ${window}`],
  [
    "incident_events",
    `SELECT * FROM sre.incident_events WHERE ts > now() - INTERVAL ${Number(minutes)} MINUTE`,
  ],
];
for (const [table, sql] of tables) {
  const bytes = await native(sql);
  const packed = Bun.zstdCompressSync(bytes, { level: 19 });
  writeFileSync(join(out, `${table}.native.zst`), packed);
  console.log(`  ${table.padEnd(16)} ${(packed.length / 1024).toFixed(0)} KB`);
}

const composeFile = join(ROOT, "world", "compose.yml");
const compose = ["docker", "compose", "-p", "gullrock", "--env-file", ENV_PATH, "-f", composeFile];
const bookingsQuery = "SELECT coalesce(json_agg(b), '[]') FROM bookings b";
const psqlCommand = ["exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "gullrock"];
const psql = Bun.spawnSync([...compose, ...psqlCommand, "-At", "-c", bookingsQuery], {
  stdout: "pipe",
  stderr: "pipe",
});
if (psql.exitCode !== 0) throw new Error(psql.stderr.toString());
const bookings: Record<string, unknown>[] = JSON.parse(psql.stdout.toString());
// Emails are personal data, so a recording never keeps them.
const anonymised = bookings.map((booking) => ({ ...booking, email: "[recorded]" }));
writeFileSync(join(out, "bookings.json"), `${JSON.stringify(anonymised)}\n`);
console.log(`  bookings         ${bookings.length} rows (emails replaced)`);
// biome-ignore lint/style/useNamingConvention: recording.json keeps its snake_case field.
const summary = { name, minutes: Number(minutes), recorded_at: new Date().toISOString() };
writeFileSync(join(out, "recording.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Recorded ${name} to world/recordings/${name}.`);
