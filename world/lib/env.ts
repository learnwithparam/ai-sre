// The one place that reads and writes .env. Values are generated here and never printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..", "..");
export const ENV_PATH = join(ROOT, ".env");

const token = (bytes = 24) =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");

// Everything the world needs that it can make for itself. Model keys are never generated.
export const GENERATED: Record<string, () => string> = {
  HYPERDX_API_KEY: () => crypto.randomUUID(),
  HYPERDX_ACCESS_KEY: () => crypto.randomUUID(),
  HYPERDX_USER_EMAIL: () => "oncall@gullrock.test",
  HYPERDX_USER_PASSWORD: () => `Gr-${token(12)}`,
  CLICKHOUSE_READER_PASSWORD: () => token(),
  CLICKHOUSE_WRITER_PASSWORD: () => token(),
  POSTGRES_PASSWORD: () => token(),
  SRE_MCP_TOKEN: () => token(32),
  SRE_SESSION_SECRET: () => token(32),
  SRE_APPROVER_EMAIL: () => "oncall@gullrock.test",
  SRE_APPROVER_PASSWORD: () => token(12),
};

export function readEnv(path = ENV_PATH): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// Adds every missing generated value; never overwrites one. Returns the names it added.
export function ensureEnv(path = ENV_PATH): string[] {
  const current = readEnv(path);
  const lines = existsSync(path)
    ? readFileSync(path, "utf8").split("\n")
    : readFileSync(join(ROOT, ".env.example"), "utf8").split("\n");
  const added: string[] = [];
  for (const [key, make] of Object.entries(GENERATED)) {
    if (current[key]) continue;
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${make()}`;
    else lines.push(`${key}=${make()}`);
    added.push(key);
  }
  if (!lines.some((l) => l.startsWith("WORLD_DIR="))) lines.push(`WORLD_DIR=${ROOT}`);
  else lines[lines.findIndex((l) => l.startsWith("WORLD_DIR="))] = `WORLD_DIR=${ROOT}`;
  writeFileSync(path, lines.join("\n").replace(/\n*$/, "\n"));
  return added;
}

// Process env wins, so a learner can override one value for one command.
export const env = (): Record<string, string> => ({
  ...readEnv(),
  ...(process.env as Record<string, string>),
});
