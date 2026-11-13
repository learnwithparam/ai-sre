// bun run models: one tiny call per role on the chosen provider. Prints provider, role, pass or fail and cost.
// It never prints a key.
import { generateText } from "ai";
import { model, modelId, PRICES, provider, type Role } from "../config/models";

const p = provider();
let failed = 0;
for (const role of ["fast", "smart", "judge"] as Role[]) {
  try {
    const r = await generateText({
      model: model(role, "models-ping"),
      prompt: "Reply with the single word ok.",
      maxOutputTokens: 16,
    });
    const price = PRICES[modelId(role)];
    const inT = r.usage.inputTokens ?? 0,
      outT = r.usage.outputTokens ?? 0;
    const cost =
      p === "replay"
        ? "USD 0 (replay)"
        : price
          ? `USD ${((inT * price[0] + outT * price[1]) / 1e6).toFixed(6)}`
          : `${inT} in, ${outT} out (no price listed)`;
    const ok = /ok/i.test(r.text);
    if (!ok) failed++;
    console.log(`  ${p.padEnd(10)} ${role.padEnd(6)} ${ok ? "pass" : "fail"}  ${cost}`);
  } catch (err) {
    failed++;
    console.log(
      `  ${p.padEnd(10)} ${role.padEnd(6)} fail  ${(err as Error).message.slice(0, 120)}`,
    );
  }
}
console.log(
  failed
    ? `${failed} role(s) failed. Check LLM_PROVIDER and its key in .env.`
    : `Every role answers on ${p}.`,
);
process.exit(failed ? 1 : 0);
