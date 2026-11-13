// Replay: a recorded run played back as a model, so the course, its checks and CI need no key.
// A cassette is a list of steps. Each step is one tool call or the final text. Tool inputs can point at
// earlier tool results ({"$from": tool, "path": ..., "take": n, "match": regex}), so a replayed agent
// cites the trace ids and log lines of THIS run, and grounding checks it like any live answer.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModel } from "ai";

type Ref = { $from: string; path: string; take?: number; match?: string; join?: string };
type Step = { tool: string; input: Record<string, unknown> } | { text: string };
type Cassette = { name: string; steps: Step[] };

export const CASSETTES = join(import.meta.dir, "cassettes");

function dig(value: unknown, path: string): unknown[] {
  let cur: unknown[] = [value];
  for (const key of path.split(".").filter(Boolean)) {
    const next: unknown[] = [];
    for (const v of cur) {
      if (key === "*" && Array.isArray(v)) next.push(...v);
      else if (v && typeof v === "object" && key in (v as object))
        next.push((v as Record<string, unknown>)[key]);
    }
    cur = next;
  }
  return cur;
}

function resolve(value: unknown, results: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((v) => resolve(v, results));
  if (!value || typeof value !== "object") return value;
  const ref = value as Ref;
  if (typeof ref.$from === "string") {
    let found = dig(results[ref.$from], ref.path).filter(
      (v) => v !== null && v !== undefined && v !== "",
    );
    if (ref.match) {
      const re = new RegExp(ref.match);
      found = found.map((v) => String(v).match(re)?.[0]).filter(Boolean) as string[];
    }
    found = [...new Set(found.map((v) => (typeof v === "object" ? JSON.stringify(v) : v)))].map(
      (v) => (typeof v === "string" && v.startsWith("{") ? JSON.parse(v) : v),
    );
    if (ref.take === undefined) return found[0] ?? "";
    return found.slice(0, ref.take);
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, results)]));
}

// Tool results arrive as the tool messages of the prompt. The latest result of each tool wins.
function toolResults(prompt: any[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of prompt) {
    if (m.role !== "tool") continue;
    for (const part of m.content) {
      if (part.type !== "tool-result") continue;
      const o = part.output ?? {};
      let v: unknown = o.value;
      if (o.type === "content" && Array.isArray(o.value))
        v = o.value.map((c: any) => c.text ?? "").join("");
      if (typeof v === "string") {
        try {
          v = JSON.parse(v);
        } catch {
          /* plain text */
        }
      }
      // MCP tools return { content: [{ type: "text", text: "<json>" }], structuredContent? }
      if (
        v &&
        typeof v === "object" &&
        "structuredContent" in (v as object) &&
        (v as any).structuredContent
      )
        v = (v as any).structuredContent;
      else if (v && typeof v === "object" && Array.isArray((v as any).content)) {
        const text = (v as any).content.map((c: any) => c.text ?? "").join("");
        try {
          v = JSON.parse(text);
        } catch {
          v = text;
        }
      }
      out[part.toolName] = v;
    }
  }
  return out;
}

export function loadCassette(name: string): Cassette {
  return JSON.parse(readFileSync(join(CASSETTES, `${name}.json`), "utf8"));
}

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

export function replayModel(cassette: string): LanguageModel {
  return {
    specificationVersion: "v4",
    provider: "replay",
    modelId: `replay:${cassette}`,
    supportedUrls: {},
    async doGenerate(options: any) {
      const steps = loadCassette(cassette).steps;
      const turn = options.prompt.filter((m: any) => m.role === "assistant").length;
      const step = steps[Math.min(turn, steps.length - 1)];
      const finish = (unified: string) => ({ unified, raw: unified });
      if ("text" in step || turn >= steps.length) {
        const text = "text" in step ? step.text : "Done.";
        return {
          content: [{ type: "text", text }],
          finishReason: finish("stop"),
          usage,
          warnings: [],
        };
      }
      const input = resolve(step.input, toolResults(options.prompt));
      return {
        content: [
          {
            type: "tool-call",
            toolCallId: `replay-${turn}`,
            toolName: step.tool,
            input: JSON.stringify(input),
          },
        ],
        finishReason: finish("tool-calls"),
        usage,
        warnings: [],
      };
    },
    async doStream() {
      throw new Error("replay mode answers generateText only");
    },
  } as unknown as LanguageModel;
}
