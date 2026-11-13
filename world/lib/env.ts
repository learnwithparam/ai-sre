// The one place that reads and writes .env. Values are generated here and never printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..", "..");
export const ENV_PATH = join(ROOT, ".env");

function randomToken(bytes = 24): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(bytes));
  return Buffer.from(randomBytes).toString("base64url");
}

// Everything the world needs that it can make for itself. Model keys are never generated.
export const GENERATED = new Map<string, () => string>([
  ["HYPERDX_API_KEY", () => crypto.randomUUID()],
  ["HYPERDX_ACCESS_KEY", () => crypto.randomUUID()],
  ["HYPERDX_USER_EMAIL", () => "oncall@gullrock.test"],
  ["HYPERDX_USER_PASSWORD", () => `Gr-${randomToken(12)}`],
  ["CLICKHOUSE_READER_PASSWORD", () => randomToken()],
  ["CLICKHOUSE_WRITER_PASSWORD", () => randomToken()],
  ["POSTGRES_PASSWORD", () => randomToken()],
  ["SRE_MCP_TOKEN", () => randomToken(32)],
  ["SRE_SESSION_SECRET", () => randomToken(32)],
  ["SRE_APPROVER_EMAIL", () => "oncall@gullrock.test"],
  ["SRE_APPROVER_PASSWORD", () => randomToken(12)],
]);

export function readEnv(path = ENV_PATH): Record<string, string> {
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

// Sets KEY=value in place if the key is already there, or adds it at the end.
function setLine(lines: string[], key: string, value: string): void {
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) lines[index] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
}

// Adds every missing generated value; never overwrites one. Returns the names it added.
export function ensureEnv(path = ENV_PATH): string[] {
  const current = readEnv(path);
  const startingFile = existsSync(path) ? path : join(ROOT, ".env.example");
  const lines = readFileSync(startingFile, "utf8").split("\n");
  const added: string[] = [];
  for (const [key, makeValue] of GENERATED) {
    if (current[key]) continue;
    setLine(lines, key, makeValue());
    added.push(key);
  }
  setLine(lines, "WORLD_DIR", ROOT);
  writeFileSync(path, lines.join("\n").replace(/\n*$/, "\n"));
  return added;
}

// Process env wins, so a learner can override one value for one command.
export const env = (): Record<string, string> => ({
  ...readEnv(),
  ...(process.env as Record<string, string>),
});
