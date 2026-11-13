// bun parts/03-look-without-touching/list-tools.ts
// Asks both MCP servers of the world for their tools (tools/list) and prints each tool with
// what it says about itself: READ when readOnlyHint is true, WRITE when it is not.
// With --save it also writes the answers to tools/, where the check reads them.
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env } from "../../world/lib/env";

export type ToolSummary = { name: string; readOnlyHint: boolean; description: string };

const settings = env();
const SERVERS = [
  { name: "hyperdx", url: "http://localhost:8080/api/mcp", token: settings.HYPERDX_ACCESS_KEY },
  { name: "harbour-control", url: "http://localhost:8090/mcp", token: settings.SRE_MCP_TOKEN },
];

async function listTools(url: string, token: string): Promise<ToolSummary[]> {
  const client = new Client({ name: "list-tools", version: "1.0.0" });
  const headers = { authorization: `Bearer ${token}` };
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
  });
  await client.connect(transport);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((tool) => ({
    name: tool.name,
    readOnlyHint: tool.annotations?.readOnlyHint === true,
    description: (tool.description ?? "").split("\n")[0].slice(0, 70),
  }));
}

function printServer(name: string, url: string, tools: ToolSummary[]) {
  const writeTools = tools.filter((tool) => !tool.readOnlyHint);
  console.log(`${name}  ${url}  ${tools.length} tools, ${writeTools.length} can write`);
  for (const tool of tools) {
    const kind = tool.readOnlyHint ? "READ " : "WRITE";
    console.log(`  ${kind}  ${tool.name}`);
  }
  console.log("");
}

const save = process.argv.includes("--save");
try {
  for (const server of SERVERS) {
    const tools = await listTools(server.url, server.token);
    printServer(server.name, server.url, tools);
    if (save) {
      const path = join(import.meta.dir, "tools", `${server.name}.json`);
      await Bun.write(path, `${JSON.stringify(tools, null, 2)}\n`);
    }
  }
} catch (error) {
  console.log(`Could not reach an MCP server: ${(error as Error).message}`);
  console.log("Start the world with bun run world, then run this again.");
  process.exit(1);
}
