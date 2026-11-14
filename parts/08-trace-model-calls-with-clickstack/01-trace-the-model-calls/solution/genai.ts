// One span around each model call, named by the OpenTelemetry GenAI conventions.
// The conventions are in Development status, so names can still change.
import { SpanKind, SpanStatusCode, type Tracer } from "@opentelemetry/api";

export type ModelCall = { provider: string; requestModel: string };
export type ModelAnswer = { responseModel: string; inputTokens: number; outputTokens: number };

export const ATTRIBUTES = {
  operation: "gen_ai.operation.name",
  provider: "gen_ai.provider.name",
  requestModel: "gen_ai.request.model",
  responseModel: "gen_ai.response.model",
  inputTokens: "gen_ai.usage.input_tokens",
  outputTokens: "gen_ai.usage.output_tokens",
  errorType: "error.type",
};

export function traceModelCall(
  tracer: Tracer,
  call: ModelCall,
  run: () => Promise<ModelAnswer>,
): Promise<ModelAnswer> {
  const options = { kind: SpanKind.CLIENT };
  return tracer.startActiveSpan(`chat ${call.requestModel}`, options, async (span) => {
    span.setAttribute(ATTRIBUTES.operation, "chat");
    span.setAttribute(ATTRIBUTES.provider, call.provider);
    span.setAttribute(ATTRIBUTES.requestModel, call.requestModel);
    try {
      const answer = await run();
      span.setAttribute(ATTRIBUTES.responseModel, answer.responseModel);
      span.setAttribute(ATTRIBUTES.inputTokens, answer.inputTokens);
      span.setAttribute(ATTRIBUTES.outputTokens, answer.outputTokens);
      return answer;
    } catch (error) {
      const name = error instanceof Error ? error.name : "_OTHER";
      span.setAttribute(ATTRIBUTES.errorType, name);
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      throw error;
    } finally {
      span.end();
    }
  });
}
