// Opens the span and never ends it, so it is never exported.
import { trace } from "@opentelemetry/api";
import type { CheckinStore } from "../store";

const tracer = trace.getTracer("booking-web");

export async function validateCheckin(ref: string, store: CheckinStore): Promise<string | null> {
  return tracer.startActiveSpan("checkin.validate", async (span) => {
    span.setAttribute("booking.ref", ref);
    const booking = await store.findBooking(ref);
    if (!booking) return "no booking with that reference";
    if (booking.status === "checked_in") return "this booking is already checked in";
    return null;
  });
}
