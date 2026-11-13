// bun parts/04-say-what-broke/call-tool.ts <tool> <file.json>    send the fields in a file
// bun parts/04-say-what-broke/call-tool.ts <tool> '{"key": "value"}'  send the fields you type
//
// A bare MCP client for harbour-control. It sends exactly what you wrote to one tool, the same
// way your AI SRE does, so the server checks it in the same way. Use it when you have no model
// key: you do the thinking, and harbour-control does the checking.
//
// When the answer holds a finding_id or an action_id, it is written back into your file, so
// the check can find what harbour-control stored.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env } from "../../world/lib/env";

type Fields = Record<string, unknown>;
type ToolAnswer = { content?: { type: string; text?: string }[]; isError?: boolean };

const IDS_TO_KEEP = ["finding_id", "action_id"];

function readFields(argument: string): { fields: Fields; file: string } {
  if (argument.trim().startsWith("{")) return { fields: JSON.parse(argument), file: "" };
  const file = resolve(argument);
  if (!existsSync(file)) throw new Error(`there is no file ${argument}`);
  return { fields: JSON.parse(readFileSync(file, "utf8")), file };
}

// Send only the fields the tool takes. The ids written back by an earlier call stay in the
// file but are not sent, because harbour-control refuses fields it does not know.
function onlyKnownFields(fields: Fields, known: string[]): Fields {
  const entries = Object.entries(fields).filter(([key]) => known.includes(key));
  return Object.fromEntries(entries);
}

function answerText(answer: ToolAnswer): string {
  const texts = (answer.content ?? []).map((part) => part.text ?? "");
  return texts.join("\n");
}

function writeIdsBack(file: string, fields: Fields, text: string): void {
  let parsed: Fields = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    // The answer was plain text, so there is no id to keep.
    return;
  }
  const found = IDS_TO_KEEP.filter((key) => typeof parsed[key] === "string");
  if (!file || found.length === 0) return;
  for (const key of found) fields[key] = parsed[key];
  writeFileSync(file, `${JSON.stringify(fields, null, 2)}\n`);
  const names = found.map((key) => `${key} ${parsed[key]}`).join(" and ");
  console.log(`Wrote ${names} into ${file}`);
}

async function connect(): Promise<Client> {
  const settings = env();
  const base = settings.SRE_PUBLIC_URL || "http://localhost:8090";
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${settings.SRE_MCP_TOKEN}` } },
  });
  const client = new Client({ name: "call-tool", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function main(): Promise<number> {
  const [toolName, argument = "{}"] = process.argv.slice(2);
  if (!toolName) {
    console.log("Name a tool and a file: call-tool.ts submit_finding findings/bad-release.json");
    return 1;
  }
  const { fields, file } = readFields(argument);
  const client = await connect();
  try {
    const { tools } = await client.listTools();
    const tool = tools.find((candidate) => candidate.name === toolName);
    if (!tool) {
      const names = tools.map((candidate) => candidate.name).join(", ");
      console.log(`harbour-control has no tool ${toolName}. Its tools: ${names}`);
      return 1;
    }
    const known = Object.keys(tool.inputSchema.properties ?? {});
    const sent = onlyKnownFields(fields, known);
    const answer = (await client.callTool({ name: toolName, arguments: sent })) as ToolAnswer;
    const text = answerText(answer);
    if (answer.isError) {
      console.log(`REFUSED  ${toolName}: ${text}`);
      return 1;
    }
    console.log(text);
    writeIdsBack(file, fields, text);
    return 0;
  } finally {
    await client.close();
  }
}

try {
  process.exit(await main());
} catch (error) {
  console.log(`Could not call harbour-control: ${(error as Error).message}`);
  console.log("Is the world up? Run bun run world status.");
  process.exit(2);
}
