// Query the live ClickHouse as the read-only sre_agent user,
// the same user the AI SRE reads through.
import { env } from "./env";

export async function chQuery<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, string | number> = {},
  user = "sre_agent",
): Promise<T[]> {
  const settings = env();
  const url = new URL(settings.CLICKHOUSE_URL ?? "http://localhost:8123/");
  url.searchParams.set("default_format", "JSONEachRow");
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(`param_${name}`, String(value));
  }
  const password =
    user === "sre_agent"
      ? settings.CLICKHOUSE_READER_PASSWORD
      : settings.CLICKHOUSE_WRITER_PASSWORD;
  const response = await fetch(url, {
    method: "POST",
    body: sql,
    headers: { "X-ClickHouse-User": user, "X-ClickHouse-Key": password ?? "" },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text.split("\n")[0].slice(0, 300));
  const body = text.trim();
  if (!body) return [];
  return body.split("\n").map((row) => JSON.parse(row));
}

export async function chReachable(): Promise<boolean> {
  const pingUrl = new URL("/ping", env().CLICKHOUSE_URL ?? "http://localhost:8123/");
  try {
    const response = await fetch(pingUrl, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}
