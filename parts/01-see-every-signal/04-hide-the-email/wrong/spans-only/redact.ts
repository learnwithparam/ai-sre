// Cleans span attributes but forgets the log lines, which name the passenger too.

// Matches one email address, such as ana@example.test.
const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function redactBody(body: string): string {
  return body;
}

export function redactAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    redacted[key] = typeof value === "string" ? value.replace(EMAIL_ADDRESS, "[email]") : value;
  }
  return redacted;
}
