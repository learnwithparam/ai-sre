// Check-in at the quay: is this booking real, paid, and not checked in already?
import { trace } from "@opentelemetry/api";
import type { CheckinStore } from "../store";

const tracer = trace.getTracer("booking-web");

export async function validateCheckin(ref: string, store: CheckinStore): Promise<string | null> {
  // `void tracer` does nothing. It only stops the warning that tracer is unused.
  // Replace it with your span.
  void tracer;
  const booking = await store.findBooking(ref);
  if (!booking) return "no booking with that reference";
  if (booking.status === "checked_in") return "this booking is already checked in";
  return null;
}
