// Start booking-web with the learner's hooks from a step folder, on SQLite, sending telemetry to a
// local receiver. The check then uses the site like a passenger and judges what the telemetry says.
import { join } from "node:path";
import { ROOT } from "../../world/lib/env";
import { startReceiver } from "./otlp";

export type Booking = Awaited<ReturnType<typeof startBooking>>;

// What booking-web answered: the status, the body as JSON when it is JSON, and the raw text.
// The checks only read the booking reference from the JSON.
type ResponseJson = { ref?: string } | null;
type SiteAnswer = { status: number; json: ResponseJson; text: string };

function startServer(hooksDir: string, release: string, port: number, telemetryUrl: string) {
  return Bun.spawn(["bun", join(ROOT, "world", "booking-web", "src", "server.ts")], {
    // biome-ignore-start lint/style/useNamingConvention: environment variable names are upper case.
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      PORT: String(port),
      HOST: "127.0.0.1",
      DATABASE_URL: "sqlite://:memory:",
      BOOKING_RELEASE: release,
      BOOKING_HOOKS_DIR: hooksDir,
      OTEL_EXPORTER_OTLP_ENDPOINT: telemetryUrl,
      OTEL_EXPORT_DELAY_MS: "100",
      BOOKING_QUIET: "1",
    },
    // biome-ignore-end lint/style/useNamingConvention: environment variable names are upper case.
    stdout: "pipe",
    stderr: "pipe",
  });
}

// Ask /health up to 100 times, 100 ms apart, so a slow start still counts as up.
async function waitUntilUp(baseUrl: string): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    const healthy = await fetch(`${baseUrl}/health`)
      .then((response) => response.ok)
      .catch(() => false);
    if (healthy) return true;
    await Bun.sleep(100);
  }
  return false;
}

function parseJson(text: string): ResponseJson {
  try {
    return JSON.parse(text);
  } catch {
    // The page sent HTML, not JSON.
    return null;
  }
}

function siteCaller(baseUrl: string) {
  return async (method: string, path: string, body?: unknown): Promise<SiteAnswer> => {
    const response = await fetch(baseUrl + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, json: parseJson(text), text };
  };
}

export async function startBooking(hooksDir: string, release = "v7") {
  const receiver = startReceiver();
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = startServer(hooksDir, release, port, receiver.url);
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverIsUp = await waitUntilUp(baseUrl);
  const call = siteCaller(baseUrl);
  return {
    up: serverIsUp,
    release,
    ...receiver,
    call,
    async book(email = "ana@example.test") {
      return call("POST", "/api/bookings", {
        name: "Ana Ferreira",
        email,
        // biome-ignore lint/style/useNamingConvention: booking-web reads this snake_case field.
        sailing_id: "2",
        vehicle: "car",
        card: "4000000000000001",
      });
    },
    async flush() {
      await call("POST", "/telemetry/flush");
      await Bun.sleep(150);
    },
    async stop() {
      server.kill();
      await server.exited;
      receiver.stop();
    },
  };
}

// Runs one session against booking-web and caches it per folder, so each rule reads the same run.
const runs = new Map<string, Promise<unknown>>();
export function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  let saved = runs.get(key);
  if (!saved) {
    saved = run();
    runs.set(key, saved);
  }
  return saved as Promise<T>;
}
