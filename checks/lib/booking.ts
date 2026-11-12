// Start booking-web with the learner's hooks from a step folder, on SQLite, sending telemetry to a local
// receiver. The check then uses the site like a passenger and judges what the telemetry says.
import { join } from "node:path";
import { ROOT } from "../../world/lib/env";
import { startReceiver } from "./otlp";

export type Booking = Awaited<ReturnType<typeof startBooking>>;

export async function startBooking(hooksDir: string, release = "v7") {
  const receiver = startReceiver();
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = Bun.spawn(["bun", join(ROOT, "world", "booking-web", "src", "server.ts")], {
    env: {
      PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "",
      PORT: String(port), HOST: "127.0.0.1", DATABASE_URL: "sqlite://:memory:", BOOKING_RELEASE: release,
      BOOKING_HOOKS_DIR: hooksDir, OTEL_EXPORTER_OTLP_ENDPOINT: receiver.url, OTEL_EXPORT_DELAY_MS: "100", BOOKING_QUIET: "1",
    },
    stdout: "pipe", stderr: "pipe",
  });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    up = await fetch(`${base}/health`).then((r) => r.ok).catch(() => false);
    if (!up) await Bun.sleep(100);
  }
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, text };
  };
  return {
    up, release, ...receiver, call,
    async book(email = "ana@example.test") {
      return call("POST", "/api/bookings", { name: "Ana Ferreira", email, sailing_id: "2", vehicle: "car", card: "4000000000000001" });
    },
    async flush() { await call("POST", "/telemetry/flush"); await Bun.sleep(150); },
    async stop() { proc.kill(); await proc.exited; receiver.stop(); },
  };
}

// Runs one session against booking-web and caches it per folder, so each rule reads the same run.
const runs = new Map<string, Promise<any>>();
export function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  if (!runs.has(key)) runs.set(key, run());
  return runs.get(key)!;
}
