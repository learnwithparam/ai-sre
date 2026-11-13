// Passenger emails are personal data. They stay in the bookings table and never leave in telemetry.
// Both functions run on every span and log record just before it is exported.

// Matches one email address, such as ana@example.test.
const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function redactBody(body: string): string {
  return body.replace(EMAIL_ADDRESS, "[email]");
}

export function redactAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    redacted[key] = typeof value === "string" ? redactBody(value) : value;
  }
  return redacted;
}
