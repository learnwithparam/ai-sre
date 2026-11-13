// connect-the-read-tools: reads your client's MCP config (.mcp.json) and its permissions
// (.claude/settings.json), the way Claude Code reads them from the folder it starts in.
// Every allowed tool must say readOnlyHint true in its server's tools/list answer, and every
// tool that can write must be denied. Then ClickHouse itself must refuse a write.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import { chQuery, chReachable } from "../world/lib/clickhouse";
import { ENV_PATH } from "../world/lib/env";
import { field, read } from "./lib/files";
import { sourceFor } from "./lib/world";

type ToolSummary = { name: string; readOnlyHint: boolean };
type ServerConfig = { url?: string; headers?: Record<string, string> };
type Server = { name: string; tools: ToolSummary[] };

// The tools/list answers of both servers, saved from the world by list-tools.ts --save.
const TOOLS = join(import.meta.dir, "..", "parts", "03-look-without-touching", "tools");
const KNOWN_SERVERS = [
  { file: "hyperdx.json", url: /^http:\/\/localhost:8080\/api\/mcp\/?$/ },
  { file: "harbour-control.json", url: /^http:\/\/localhost:8090\/mcp\/?$/ },
];

function readJson(folder: string, fileName: string): Record<string, unknown> {
  try {
    return JSON.parse(read(folder, fileName) || "{}");
  } catch {
    return {};
  }
}

function serverConfigs(folder: string): Record<string, ServerConfig> {
  const config = readJson(folder, ".mcp.json");
  return (config.mcpServers ?? {}) as Record<string, ServerConfig>;
}

// Each server in your .mcp.json that is one of the world's two, with the tools it offers.
function servers(folder: string): Server[] {
  const found: Server[] = [];
  for (const [name, config] of Object.entries(serverConfigs(folder))) {
    const known = KNOWN_SERVERS.find((server) => server.url.test(config.url ?? ""));
    if (!known) continue;
    const tools = JSON.parse(readFileSync(join(TOOLS, known.file), "utf8")) as ToolSummary[];
    found.push({ name, tools });
  }
  return found;
}

function permissions(folder: string): { allow: string[]; deny: string[] } {
  const settings = readJson(folder, join(".claude", "settings.json"));
  const lists = (settings.permissions ?? {}) as { allow?: string[]; deny?: string[] };
  return { allow: lists.allow ?? [], deny: lists.deny ?? [] };
}

// The tool an allow entry names, or undefined when it names no known tool.
function toolFor(folder: string, entry: string): ToolSummary | undefined {
  for (const server of servers(folder)) {
    const prefix = `mcp__${server.name}__`;
    if (!entry.startsWith(prefix)) continue;
    return server.tools.find((tool) => tool.name === entry.slice(prefix.length));
  }
  return undefined;
}

function hasServerAt(folder: string, url: RegExp): boolean {
  return Object.values(serverConfigs(folder)).some((config) => url.test(config.url ?? ""));
}

// "NAME=value" becomes "value". A value may hold "=" itself.
function valueAfterEquals(line: string): string {
  const afterTheName = line.split("=").slice(1);
  return afterTheName.join("=").trim();
}

// Secrets from your .env, so the check can make sure none of them is pasted into the config.
function secretValues(): string[] {
  if (!existsSync(ENV_PATH)) return [];
  const lines = readFileSync(ENV_PATH, "utf8").split("\n");
  const values = lines.map((line) => valueAfterEquals(line));
  return values.filter((value) => value.length >= 12);
}

function keysStayOutOfTheFile(folder: string): boolean {
  const configs = Object.values(serverConfigs(folder));
  const headers = configs.flatMap((config) => Object.values(config.headers ?? {}));
  const headersNameVariables = headers.every((value) => /^Bearer \$\{\w+\}$/.test(value));
  const text = read(folder, ".mcp.json");
  const noSecretPasted = secretValues().every((secret) => !text.includes(secret));
  return headers.length > 0 && headersNameVariables && noSecretPasted;
}

function everyWriteToolDenied(folder: string): boolean {
  const { deny } = permissions(folder);
  const found = servers(folder);
  return (
    found.length === 2 &&
    found.every((server) =>
      server.tools
        .filter((tool) => !tool.readOnlyHint)
        .every((tool) => deny.includes(`mcp__${server.name}__${tool.name}`)),
    )
  );
}

const CLICKHOUSE_REFUSED = /ACCESS_DENIED|Not enough privileges|readonly mode/;

async function insertIsRefusedNow(folder: string): Promise<boolean> {
  if (sourceFor(folder).kind === "recorded") return true;
  if (!(await chReachable())) return false;
  try {
    await chQuery("INSERT INTO otel_logs (ServiceName, Body) VALUES ('booking-web', 'check')");
    return false;
  } catch (error) {
    return CLICKHOUSE_REFUSED.test((error as Error).message);
  }
}

const allowList = (folder: string) => permissions(folder).allow;

export default [
  {
    says: ".mcp.json names HyperDX's MCP server at http://localhost:8080/api/mcp",
    test: (folder) => hasServerAt(folder, KNOWN_SERVERS[0].url),
    tryNext:
      'add a server to mcpServers with "type": "http" and "url": "http://localhost:8080/api/mcp"',
  },
  {
    says: ".mcp.json names harbour-control's MCP server at http://localhost:8090/mcp",
    test: (folder) => hasServerAt(folder, KNOWN_SERVERS[1].url),
    tryNext: 'add a second server with "url": "http://localhost:8090/mcp"',
  },
  {
    says: "no key is written in .mcp.json; each header names a variable from .env",
    test: (folder) => keysStayOutOfTheFile(folder),
    tryNext:
      'write each header as "Authorization": "Bearer $' +
      '{HYPERDX_ACCESS_KEY}" or "Bearer $' +
      '{SRE_MCP_TOKEN}"; your client fills the value in from the environment',
  },
  {
    says: "the allow list names single tools, never a whole server or a wildcard",
    test: (folder) => {
      const allow = allowList(folder);
      return allow.length > 0 && allow.every((entry) => /^mcp__[\w-]+__\w+$/.test(entry));
    },
    tryNext:
      "replace an entry such as mcp__hyperdx with single tools, " +
      "such as mcp__hyperdx__clickstack_search",
  },
  {
    says: "every allowed tool says readOnlyHint true in its server's tools/list",
    test: (folder) => {
      const allow = allowList(folder);
      return allow.length > 0 && allow.every((entry) => toolFor(folder, entry)?.readOnlyHint);
    },
    tryNext:
      "run bun parts/03-look-without-touching/list-tools.ts and allow only tools marked READ; " +
      "check each name, letter by letter",
  },
  {
    says: "you allow at least one read tool from each server",
    test: (folder) =>
      servers(folder).length === 2 &&
      servers(folder).every((server) =>
        allowList(folder).some((entry) => entry.startsWith(`mcp__${server.name}__`)),
      ),
    tryNext: "allow at least one READ tool of each server, named mcp__<server name>__<tool name>",
  },
  {
    says: "every tool that can write is in the deny list",
    test: (folder) => everyWriteToolDenied(folder),
    tryNext: "put every tool marked WRITE by list-tools.ts in permissions.deny, for both servers",
  },
  {
    says: "answers.md shows ClickHouse refusing an INSERT from sre_agent",
    test: (folder) => CLICKHOUSE_REFUSED.test(field(read(folder, "answers.md"), "ClickHouse said")),
    tryNext:
      "run bun parts/03-look-without-touching/try-insert.ts and paste the line that starts " +
      "with Code: after ClickHouse said:",
  },
  {
    says: "right now, ClickHouse refuses an INSERT from sre_agent",
    test: (folder) => insertIsRefusedNow(folder),
    tryNext:
      "start the world with bun run world; this rule tries a real INSERT and needs it running",
  },
] satisfies Rule[];
