// Safe, and useless: with every attribute gone, no trace says which booking or route it was.

// Matches one email address, such as ana@example.test.
const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function redactBody(body: string): string {
  return body.replace(EMAIL_ADDRESS, "[email]");
}

export function redactAttributes(_attributes: Record<string, unknown>): Record<string, unknown> {
  return {};
}
