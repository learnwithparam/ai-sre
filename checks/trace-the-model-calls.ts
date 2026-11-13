// trace-the-model-calls: the AI SRE's model calls become OpenTelemetry GenAI spans. The check runs
// one pretend incident through your genai.ts and reads the spans it made, the way ClickStack would.
import type { Rule } from "../scripts/verify";
import { type Incident, modelCalls, queryAsClickstack, runIncident } from "./lib/genai";

const incidents = new Map<string, Promise<Incident | null>>();
const incidentFor = (folder: string) => {
  if (!incidents.has(folder)) incidents.set(folder, runIncident(folder));
  return incidents.get(folder) as Promise<Incident | null>;
};

const filled = (value: unknown) => value !== undefined && value !== "";

async function calls(folder: string) {
  const incident = await incidentFor(folder);
  return incident ? modelCalls(incident) : [];
}

const WITH_PROVIDER =
  "SELECT count() AS spans FROM otel_traces WHERE TraceId = '{id}' " +
  "AND SpanAttributes['gen_ai.provider.name'] != ''";

export const rules: Rule[] = [
  {
    says:
      "every model call span carries gen_ai.provider.name, " +
      "and every answered call carries gen_ai.response.model",
    test: async (folder) => {
      const spans = await calls(folder);
      const answered = spans.filter((span) => span.status.code !== 2);
      return (
        spans.length === 3 &&
        spans.every((span) => filled(span.attributes["gen_ai.provider.name"])) &&
        answered.length > 0 &&
        answered.every((span) => filled(span.attributes["gen_ai.response.model"]))
      );
    },
    tryNext: "in genai.ts fill in ATTRIBUTES with the exact GenAI names, then set them on the span",
  },
  {
    says: "an answered call records gen_ai.usage.input_tokens and gen_ai.usage.output_tokens",
    test: async (folder) => {
      const answered = (await calls(folder)).filter((span) => span.status.code !== 2);
      return (
        answered.length > 0 &&
        answered.every(
          (span) =>
            typeof span.attributes["gen_ai.usage.input_tokens"] === "number" &&
            typeof span.attributes["gen_ai.usage.output_tokens"] === "number",
        )
      );
    },
    tryNext: "after the call answers, set both token counts as numbers on the span",
  },
  {
    says: "a failed model call sets error.type, and an answered call does not",
    test: async (folder) => {
      const spans = await calls(folder);
      const failed = spans.filter((span) => span.status.code === 2);
      const answered = spans.filter((span) => span.status.code !== 2);
      return (
        failed.length === 1 &&
        filled(failed[0].attributes["error.type"]) &&
        answered.every((span) => span.attributes["error.type"] === undefined)
      );
    },
    tryNext: "in the catch block, set error.type before you throw the error again",
  },
  {
    says: "a ClickStack query for gen_ai.provider.name returns the model calls of one run",
    test: async (folder) => {
      const incident = await incidentFor(folder);
      if (!incident) return false;
      const sql = WITH_PROVIDER.replace("{id}", incident.traceId);
      const rows = await queryAsClickstack(incident, sql);
      return Number(rows[0]?.spans) === 3;
    },
    tryNext: "check that every model call span, failed ones too, sets gen_ai.provider.name",
  },
];

export default rules;
