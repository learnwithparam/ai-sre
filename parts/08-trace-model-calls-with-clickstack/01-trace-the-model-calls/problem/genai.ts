// Starter: fill in the attribute names above, then set them on the span in traceModelCall.
// The conventions are in Development status, so names can still change.
import { SpanKind, SpanStatusCode, type Tracer } from "@opentelemetry/api";

export type ModelCall = { provider: string; requestModel: string };
export type ModelAnswer = { responseModel: string; inputTokens: number; outputTokens: number };

export const ATTRIBUTES = {
  operation: "", // the operation name, such as chat
  provider: "", // the provider
  requestModel: "", // the model you asked for
  responseModel: "", // the model that answered
  inputTokens: "", // tokens sent
  outputTokens: "", // tokens received
  errorType: "", // the error class, set when the call fails
};

export function traceModelCall(
  tracer: Tracer,
  call: ModelCall,
  run: () => Promise<ModelAnswer>,
): Promise<ModelAnswer> {
  const options = { kind: SpanKind.CLIENT };
  return tracer.startActiveSpan(`chat ${call.requestModel}`, options, async (span) => {
    // TODO: set the operation, provider and request model here.
    try {
      const answer = await run();
      // TODO: set the response model and token counts here.
      return answer;
    } catch (error) {
      // TODO: set the error type here.
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      throw error;
    } finally {
      span.end();
    }
  });
}
