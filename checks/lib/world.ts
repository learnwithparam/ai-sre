// Which world a check reads. A folder that holds recorded-world.txt is checked against that recording;
// your problem/ folder has none, so it is checked against the live world on your machine.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chQuery, chReachable } from "../../world/lib/clickhouse";
import { ENV_PATH, ROOT } from "../../world/lib/env";
import { queryRecorded, recordedBookings } from "./recorded";

export type WorldSource = { kind: "live" } | { kind: "recorded"; name: string };

export function sourceFor(dir: string): WorldSource {
  const f = join(dir, "recorded-world.txt");
  return existsSync(f)
    ? { kind: "recorded", name: readFileSync(f, "utf8").trim() }
    : { kind: "live" };
}

export async function query<T = Record<string, unknown>>(
  dir: string,
  sql: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const src = sourceFor(dir);
  if (src.kind === "live") {
    if (!(await chReachable())) throw new Error("the world is not running: bun run world");
    return chQuery<T>(sql, params);
  }
  const bound = sql.replace(
    /\{(\w+):String\}/g,
    (_, k) => `'${String(params[k] ?? "").replace(/'/g, "")}'`,
  );
  return queryRecorded<T>(src.name, bound);
}

export async function bookingByRef(
  dir: string,
  ref: string,
): Promise<Record<string, unknown> | null> {
  const src = sourceFor(dir);
  if (src.kind === "recorded") return recordedBookings(src.name).find((b) => b.ref === ref) ?? null;
  if (!/^GR-[A-Z0-9]{6}$/.test(ref)) return null;
  const p = Bun.spawnSync(
    [
      "docker",
      "compose",
      "-p",
      "gullrock",
      "--env-file",
      ENV_PATH,
      "-f",
      join(ROOT, "world", "compose.yml"),
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "gullrock",
      "-At",
      "-c",
      `SELECT row_to_json(b) FROM bookings b WHERE ref = '${ref}'`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = p.stdout.toString().trim();
  return out ? JSON.parse(out) : null;
}
