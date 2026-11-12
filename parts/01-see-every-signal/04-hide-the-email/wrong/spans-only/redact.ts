// Cleans span attributes but forgets the log lines, which name the passenger too.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function redactBody(body: string): string {
  return body;
}

export function redactAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) out[key] = typeof value === "string" ? value.replace(EMAIL, "[email]") : value;
  return out;
}
