// Passenger emails are personal data. They stay in the bookings table and never leave in telemetry.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function redactBody(body: string): string {
  return body.replace(EMAIL, "[email]");
}

export function redactAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    out[key] = typeof value === "string" ? redactBody(value) : value;
  }
  return out;
}
