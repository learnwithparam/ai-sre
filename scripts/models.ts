// bun run models: one tiny call per role on the chosen provider. Prints provider, role,
// pass or fail and cost. It never prints a key.
import { generateText } from "ai";
import { model, modelId, PRICES, provider, type Role } from "../config/models";

const chosenProvider = provider();

type TokenUsage = { inputTokens?: number; outputTokens?: number };

function describeCost(role: Role, usage: TokenUsage): string {
  if (chosenProvider === "replay") return "USD 0 (replay)";
  const price = PRICES[modelId(role)];
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  if (!price) return `${inputTokens} in, ${outputTokens} out (no price listed)`;
  const dollars = (inputTokens * price[0] + outputTokens * price[1]) / 1e6;
  return `USD ${dollars.toFixed(6)}`;
}

let failed = 0;
for (const role of ["fast", "smart", "judge"] as Role[]) {
  const label = `  ${chosenProvider.padEnd(10)} ${role.padEnd(6)}`;
  try {
    const result = await generateText({
      model: model(role, "models-ping"),
      prompt: "Reply with the single word ok.",
      maxOutputTokens: 16,
    });
    const cost = describeCost(role, result.usage);
    const ok = /ok/i.test(result.text);
    if (!ok) failed++;
    console.log(`${label} ${ok ? "pass" : "fail"}  ${cost}`);
  } catch (err) {
    failed++;
    console.log(`${label} fail  ${(err as Error).message.slice(0, 120)}`);
  }
}
console.log(
  failed
    ? `${failed} role(s) failed. Check LLM_PROVIDER and its key in .env.`
    : `Every role answers on ${chosenProvider}.`,
);
process.exit(failed ? 1 : 0);
