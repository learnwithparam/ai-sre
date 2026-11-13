// The reference AI SRE for the evals. run-evals.ts starts it with INCIDENT_ID and SCENARIO set.
// It talks to harbour-control's MCP tools only, like any agent you build.
//
// bun parts/07-prove-the-ai-sre-right/reference-agent.ts [--prompt <file>]
//   --prompt swaps in your own system prompt, so you can test a prompt change against the
//   baseline. In replay mode each scenario plays its recorded run from cassettes/.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createMCPClient } from "@ai-sdk/mcp";
import { generateText, isStepCount } from "ai";
import { SYSTEM } from "../../agent/ai-sre";
import { model } from "../../config/models";
import { env } from "../../world/lib/env";

// replay.ts looks for cassettes in agent/cassettes, so this path climbs to this folder.
const cassetteFor = (scenario: string) =>
  join("..", "..", "parts", "07-prove-the-ai-sre-right", "cassettes", scenario);

function systemPrompt(words: string[]): string {
  const flagPosition = words.indexOf("--prompt");
  if (flagPosition < 0) return SYSTEM;
  const promptFile = words[flagPosition + 1];
  // agent.toml names the prompt from the step folder, such as evals/challenger-prompt.md.
  const stepFolder = process.env.STEP_FOLDER ?? "";
  const fromStepFolder = join(stepFolder, promptFile);
  if (stepFolder && existsSync(fromStepFolder)) return readFileSync(fromStepFolder, "utf8");
  return readFileSync(promptFile, "utf8");
}

async function investigate(incidentId: string, scenario: string, system: string) {
  const settings = env();
  const mcp = await createMCPClient({
    transport: {
      type: "http",
      url: `${settings.SRE_PUBLIC_URL || "http://localhost:8090"}/mcp`,
      headers: { authorization: `Bearer ${settings.SRE_MCP_TOKEN}` },
    },
  });
  try {
    const result = await generateText({
      model: model("smart", cassetteFor(scenario)),
      system,
      prompt: `Incident ${incidentId} is open at Gullrock Ferries. Investigate it.`,
      tools: await mcp.tools(),
      stopWhen: isStepCount(20),
    });
    console.log(`  AI SRE: ${result.text}`);
  } finally {
    await mcp.close();
  }
}

const incidentId = process.env.INCIDENT_ID ?? "";
const scenario = process.env.SCENARIO ?? "";
if (!incidentId || !scenario) {
  console.log("Run me through run-evals.ts, which sets INCIDENT_ID and SCENARIO.");
  process.exit(1);
}
await investigate(incidentId, scenario, systemPrompt(process.argv.slice(2)));
