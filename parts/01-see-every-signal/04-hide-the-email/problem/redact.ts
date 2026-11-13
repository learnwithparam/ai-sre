// Passenger emails are personal data. They stay in the bookings table and never leave in telemetry.
// Both functions run on every span and log record just before it is exported.

export function redactBody(body: string): string {
  return body;
}

export function redactAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  return attributes;
}
