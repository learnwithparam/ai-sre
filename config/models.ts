// The only file that names a model. Code asks for a role (fast, smart, judge), never an id.
// LLM_PROVIDER picks the provider: replay (default, no key), anthropic, openrouter, openai or ollama.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { env } from "../world/lib/env";
import { replayModel } from "../agent/replay";

export type Role = "fast" | "smart" | "judge";
export type Provider = "replay" | "anthropic" | "openrouter" | "openai" | "ollama";

// Ids read from the live model lists on the build date; see briefs/MODELS.md in the curriculum repo.
export const IDS: Record<Exclude<Provider, "replay" | "ollama">, Record<Role, string>> = {
  anthropic: { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5", judge: "claude-haiku-5-5" },
  openrouter: { fast: "nvidia/nemotron-3.5-lightning", smart: "anthropic/claude-sonnet-5.5", judge: "anthropic/claude-haiku-5.5" },
  openai: { fast: "gpt-6-luna", smart: "gpt-6-luna-pro", judge: "gpt-6-luna" },
};

// USD per million tokens, input and output, where the provider's own page states it.
export const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "nvidia/nemotron-3.5-lightning": [0.07, 0.2],
};

export const KEYS: Record<Provider, string | null> = {
  replay: null, ollama: null, anthropic: "ANTHROPIC_API_KEY", openrouter: "OPENROUTER_API_KEY", openai: "OPENAI_API_KEY",
};

export function provider(): Provider {
  const p = (env().LLM_PROVIDER || "replay") as Provider;
  if (!(p in KEYS)) throw new Error(`LLM_PROVIDER=${p} is not one of ${Object.keys(KEYS).join(", ")}`);
  return p;
}

export function modelId(role: Role): string {
  const p = provider();
  if (p === "replay") return `replay-${role}`;
  if (p === "ollama") return env().OLLAMA_MODEL || "set OLLAMA_MODEL in .env";
  return IDS[p][role];
}

// cassette: which recorded run replay mode plays back. Live providers ignore it.
export function model(role: Role, cassette = "models-ping"): LanguageModel {
  const p = provider();
  const e = env();
  const key = KEYS[p] ? e[KEYS[p]!] : "";
  if (KEYS[p] && !key) throw new Error(`LLM_PROVIDER=${p} needs ${KEYS[p]} in .env`);
  switch (p) {
    case "replay": return replayModel(cassette);
    case "anthropic": return createAnthropic({ apiKey: key })(modelId(role));
    case "openrouter": return createOpenRouter({ apiKey: key })(modelId(role));
    case "openai": return createOpenAI({ apiKey: key })(modelId(role));
    case "ollama": return createOpenAI({ baseURL: e.OLLAMA_URL || "http://localhost:11434/v1", apiKey: "ollama" }).chat(modelId(role));
  }
}
