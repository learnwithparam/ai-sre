// Safe, and useless: with every attribute gone, no trace says which booking or route it was.
export function redactBody(body: string): string {
  return body.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
}

export function redactAttributes(_attributes: Record<string, unknown>): Record<string, unknown> {
  return {};
}
