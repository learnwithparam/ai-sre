// The only file that names a model. Code asks for a role (fast, smart, judge), never an id.
// LLM_PROVIDER picks the provider: replay (default, no key), anthropic, openrouter, openai
// or ollama.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { replayModel } from "../agent/replay";
import { env } from "../world/lib/env";

export type Role = "fast" | "smart" | "judge";
export type Provider = "replay" | "anthropic" | "openrouter" | "openai" | "ollama";

// Ids read from the live model lists on the build date; see briefs/MODELS.md in the
// curriculum repo.
export const IDS: Record<Exclude<Provider, "replay" | "ollama">, Record<Role, string>> = {
  anthropic: { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5", judge: "claude-haiku-5-5" },
  openrouter: {
    fast: "nvidia/nemotron-3.5-lightning",
    smart: "anthropic/claude-sonnet-5.5",
    judge: "anthropic/claude-haiku-5.5",
  },
  openai: { fast: "gpt-6-luna", smart: "gpt-6-luna-pro", judge: "gpt-6-luna" },
};

// USD per million tokens, input and output, where the provider's own page states it.
export const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "nvidia/nemotron-3.5-lightning": [0.07, 0.2],
};

export const KEYS: Record<Provider, string | null> = {
  replay: null,
  ollama: null,
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
};

export function provider(): Provider {
  const chosen = (env().LLM_PROVIDER || "replay") as Provider;
  if (!(chosen in KEYS)) {
    const known = Object.keys(KEYS).join(", ");
    throw new Error(`LLM_PROVIDER=${chosen} is not one of ${known}`);
  }
  return chosen;
}

export function modelId(role: Role): string {
  const chosen = provider();
  if (chosen === "replay") return `replay-${role}`;
  if (chosen === "ollama") return env().OLLAMA_MODEL || "set OLLAMA_MODEL in .env";
  return IDS[chosen][role];
}

// cassette: which recorded run replay mode plays back. Live providers ignore it.
export function model(role: Role, cassette = "models-ping"): LanguageModel {
  const chosen = provider();
  const settings = env();
  const keyName = KEYS[chosen];
  const key = keyName ? settings[keyName] : "";
  if (keyName && !key) throw new Error(`LLM_PROVIDER=${chosen} needs ${keyName} in .env`);
  switch (chosen) {
    case "replay":
      return replayModel(cassette);
    case "anthropic":
      return createAnthropic({ apiKey: key })(modelId(role));
    case "openrouter":
      return createOpenRouter({ apiKey: key })(modelId(role));
    case "openai":
      return createOpenAI({ apiKey: key })(modelId(role));
    case "ollama":
      return createOpenAI({
        // biome-ignore lint/style/useNamingConvention: the SDK names this option baseURL.
        baseURL: settings.OLLAMA_URL || "http://localhost:11434/v1",
        apiKey: "ollama",
      }).chat(modelId(role));
  }
}
