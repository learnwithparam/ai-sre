// Which world a check reads. A folder that holds recorded-world.txt is checked against that
// recording. Your problem/ folder has none, so it is checked against the live world on your
// machine.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chQuery, chReachable } from "../../world/lib/clickhouse";
import { ENV_PATH, ROOT } from "../../world/lib/env";
import { queryRecorded, recordedBookings } from "./recorded";

export type WorldSource = { kind: "live" } | { kind: "recorded"; name: string };

export function sourceFor(folder: string): WorldSource {
  const marker = join(folder, "recorded-world.txt");
  if (!existsSync(marker)) return { kind: "live" };
  return { kind: "recorded", name: readFileSync(marker, "utf8").trim() };
}

// Fill in {name:String} parameters by hand, because chdb has no query parameters.
function bindParameters(sql: string, params: Record<string, string>): string {
  return sql.replace(/\{(\w+):String\}/g, (_whole, key) => {
    const value = String(params[key] ?? "").replace(/'/g, "");
    return `'${value}'`;
  });
}

export async function query<T = Record<string, unknown>>(
  folder: string,
  sql: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const source = sourceFor(folder);
  if (source.kind === "live") {
    if (!(await chReachable())) throw new Error("the world is not running: bun run world");
    return chQuery<T>(sql, params);
  }
  return queryRecorded<T>(source.name, bindParameters(sql, params));
}

// Ask the live Postgres for one booking row, as JSON.
function liveBookingJson(ref: string): string {
  const compose = ["docker", "compose", "-p", "gullrock", "--env-file", ENV_PATH];
  const composeFile = ["-f", join(ROOT, "world", "compose.yml")];
  const psql = ["exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "gullrock", "-At"];
  const sql = `SELECT row_to_json(b) FROM bookings b WHERE ref = '${ref}'`;
  const result = Bun.spawnSync([...compose, ...composeFile, ...psql, "-c", sql], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.stdout.toString().trim();
}

export async function bookingByRef(
  folder: string,
  ref: string,
): Promise<Record<string, unknown> | null> {
  const source = sourceFor(folder);
  if (source.kind === "recorded") {
    const bookings = recordedBookings(source.name);
    return bookings.find((booking) => booking.ref === ref) ?? null;
  }
  if (!/^GR-[A-Z0-9]{6}$/.test(ref)) return null;
  const json = liveBookingJson(ref);
  return json ? JSON.parse(json) : null;
}
