// Replay: a recorded run played back as a model, so the course, its checks and CI need no key.
// A cassette is a list of steps. Each step is one tool call or the final text. Tool inputs can
// point at earlier tool results ({"$from": tool, "path": ..., "take": n, "match": regex}), so a
// replayed agent cites the trace ids and log lines of THIS run, and grounding checks it like any
// live answer.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModel } from "ai";

type Ref = { $from: string; path: string; take?: number; match?: string; join?: string };
type Step = { tool: string; input: Record<string, unknown> } | { text: string };
type Cassette = { name: string; steps: Step[] };

// The parts of the AI SDK prompt that replay reads.
type TextPart = { text?: string };
type ToolOutput = { type?: string; value?: unknown };
type PromptPart = { type: string; toolName: string; output?: ToolOutput | null };
type PromptMessage = { role: string; content: PromptPart[] };
type GenerateOptions = { prompt: PromptMessage[] };

export const CASSETTES = join(import.meta.dir, "cassettes");

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

// Follow one key into every value found so far. "*" opens a list.
function stepInto(values: unknown[], key: string): unknown[] {
  const next: unknown[] = [];
  for (const value of values) {
    if (key === "*" && Array.isArray(value)) next.push(...value);
    else if (isObject(value) && key in value) next.push(value[key]);
  }
  return next;
}

// Every value at a dotted path such as "logs.*.trace_id".
function dig(value: unknown, path: string): unknown[] {
  const keys = path.split(".").filter(Boolean);
  return keys.reduce(stepInto, [value]);
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

// Keep the first of each value. Objects are compared by their JSON text.
function unique(values: unknown[]): unknown[] {
  const keys = values.map((value) => (typeof value === "object" ? JSON.stringify(value) : value));
  return [...new Set(keys)].map((key) =>
    typeof key === "string" && key.startsWith("{") ? JSON.parse(key) : key,
  );
}

function resolveRef(ref: Ref, results: Record<string, unknown>): unknown {
  let found = dig(results[ref.$from], ref.path).filter(isPresent);
  if (ref.match) {
    const pattern = new RegExp(ref.match);
    const matches = found.map((value) => String(value).match(pattern)?.[0]);
    found = matches.filter(Boolean) as string[];
  }
  found = unique(found);
  if (ref.take === undefined) return found[0] ?? "";
  return found.slice(0, ref.take);
}

function resolve(value: unknown, results: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => resolve(item, results));
  if (!isObject(value)) return value;
  if (typeof value.$from === "string") return resolveRef(value as Ref, results);
  const entries = Object.entries(value).map(([key, item]) => [key, resolve(item, results)]);
  return Object.fromEntries(entries);
}

function joinTexts(parts: TextPart[]): string {
  return parts.map((part) => part.text ?? "").join("");
}

function parseIfJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Plain text, not JSON.
    return text;
  }
}

// MCP tools return { content: [{ type: "text", text: "<json>" }], structuredContent? }
function unwrapMcp(value: unknown): unknown {
  if (!isObject(value)) return value;
  if ("structuredContent" in value && value.structuredContent) return value.structuredContent;
  if (Array.isArray(value.content)) return parseIfJson(joinTexts(value.content));
  return value;
}

function toolResultValue(output: ToolOutput): unknown {
  let value: unknown = output.value;
  if (output.type === "content" && Array.isArray(output.value)) value = joinTexts(output.value);
  if (typeof value === "string") value = parseIfJson(value);
  return unwrapMcp(value);
}

// Tool results arrive as the tool messages of the prompt. The latest result of each tool wins.
function toolResults(prompt: PromptMessage[]): Record<string, unknown> {
  const results: Record<string, unknown> = {};
  for (const message of prompt) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      results[part.toolName] = toolResultValue(part.output ?? {});
    }
  }
  return results;
}

export function loadCassette(name: string): Cassette {
  return JSON.parse(readFileSync(join(CASSETTES, `${name}.json`), "utf8"));
}

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

const finish = (unified: string) => ({ unified, raw: unified });

function textAnswer(text: string) {
  return { content: [{ type: "text", text }], finishReason: finish("stop"), usage, warnings: [] };
}

function toolCallAnswer(turn: number, toolName: string, input: unknown) {
  const toolCall = {
    type: "tool-call",
    toolCallId: `replay-${turn}`,
    toolName,
    input: JSON.stringify(input),
  };
  return { content: [toolCall], finishReason: finish("tool-calls"), usage, warnings: [] };
}

export function replayModel(cassette: string): LanguageModel {
  return {
    specificationVersion: "v4",
    provider: "replay",
    modelId: `replay:${cassette}`,
    supportedUrls: {},
    async doGenerate(options: GenerateOptions) {
      const steps = loadCassette(cassette).steps;
      const assistantMessages = options.prompt.filter((message) => message.role === "assistant");
      const turn = assistantMessages.length;
      const step = steps[Math.min(turn, steps.length - 1)];
      if ("text" in step) return textAnswer(step.text);
      if (turn >= steps.length) return textAnswer("Done.");
      const input = resolve(step.input, toolResults(options.prompt));
      return toolCallAnswer(turn, step.tool, input);
    },
    async doStream() {
      throw new Error("replay mode answers generateText only");
    },
  } as unknown as LanguageModel;
}
