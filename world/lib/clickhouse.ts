// Query the live ClickHouse as the read-only sre_agent user, the same user the AI SRE reads through.
import { env } from "./env";

export async function chQuery<T = Record<string, unknown>>(sql: string, params: Record<string, string | number> = {}, user = "sre_agent"): Promise<T[]> {
  const e = env();
  const url = new URL(e.CLICKHOUSE_URL ?? "http://localhost:8123/");
  url.searchParams.set("default_format", "JSONEachRow");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(`param_${k}`, String(v));
  const password = user === "sre_agent" ? e.CLICKHOUSE_READER_PASSWORD : e.CLICKHOUSE_WRITER_PASSWORD;
  const res = await fetch(url, {
    method: "POST",
    body: sql,
    headers: { "X-ClickHouse-User": user, "X-ClickHouse-Key": password ?? "" },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.split("\n")[0].slice(0, 300));
  return text.trim() ? text.trim().split("\n").map((l) => JSON.parse(l)) : [];
}

export async function chReachable(): Promise<boolean> {
  try {
    const res = await fetch(new URL("/ping", env().CLICKHOUSE_URL ?? "http://localhost:8123/"), { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
