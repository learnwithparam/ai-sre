// Starts the span from ROOT_CONTEXT, so it begins a new trace
// instead of joining the check-in request.
import { ROOT_CONTEXT, trace } from "@opentelemetry/api";
import type { CheckinStore } from "../store";

const tracer = trace.getTracer("booking-web");

export async function validateCheckin(ref: string, store: CheckinStore): Promise<string | null> {
  const span = tracer.startSpan(
    "checkin.validate",
    { attributes: { "booking.ref": ref } },
    ROOT_CONTEXT,
  );
  try {
    const booking = await store.findBooking(ref);
    if (!booking) return "no booking with that reference";
    if (booking.status === "checked_in") return "this booking is already checked in";
    return null;
  } finally {
    span.end();
  }
}
