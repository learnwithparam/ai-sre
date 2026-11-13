// booking-web: Gullrock Ferries' booking site. Book a sailing, pay, check in at the quay.
import { context, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Server } from "bun";
import { Fares } from "./fares";
import { loadHooks, log, startTelemetry } from "./otel";
import { bookingPage, checkinPage } from "./pages";
import { type Booking, Store } from "./store";

const env = process.env;
const RELEASE = env.BOOKING_RELEASE ?? "v1";
const FAULT_CODE = env.FAULT_CODE ?? "";
const hooks = await loadHooks(env);
const telemetry = startTelemetry(hooks, env);
const tracer = trace.getTracer("booking-web");
const store = new Store(env.DATABASE_URL ?? "sqlite://:memory:");
await store.migrate();
const fares = new Fares(
  env.FARES_FILE ?? new URL("../../config/fares/fares-41.json", import.meta.url).pathname,
  FAULT_CODE,
);
const TIMETABLE_URL = env.TIMETABLE_URL ?? "http://localhost:8001";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Letters and digits that are hard to confuse when read aloud at the quay (no I, O, 0 or 1).
const REF_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newRef(): string {
  const randomCharacter = () => REF_CHARACTERS[Math.floor(Math.random() * 32)];
  return `GR-${Array.from({ length: 6 }, randomCharacter).join("")}`;
}

// Release v2 added an audit trail that opens its own database connection for every booking and
// holds it for a slow write. Only two such connections may be open at once.
const AUDIT_SLOTS = 2;
let auditInUse = 0;
async function auditTrail(ref: string): Promise<void> {
  const started = Date.now();
  while (auditInUse >= AUDIT_SLOTS) {
    if (Date.now() - started > 300) {
      const faultRef = FAULT_CODE ? ` ref=${FAULT_CODE}` : "";
      const inUse = `${AUDIT_SLOTS} of ${AUDIT_SLOTS} connections in use`;
      throw new Error(`connection pool exhausted: ${inUse} (audit_trail)${faultRef}`);
    }
    await Bun.sleep(20);
  }
  auditInUse++;
  try {
    await store.query(
      "INSERT audit_trail",
      "SELECT pg_sleep(1.5); INSERT INTO audit_trail ...",
      async () => {
        const { SQL } = await import("bun");
        // A fresh connection per booking: this is the defect.
        const connection = new SQL(env.DATABASE_URL ?? "", { max: 1 });
        try {
          await connection`SELECT pg_sleep(1.5)`;
        } finally {
          await connection.close();
        }
      },
    );
  } finally {
    auditInUse--;
  }
  void ref;
}

async function readJsonBody(request: Request): Promise<Record<string, string>> {
  const body = await request.json().catch(() => ({}));
  return body as Record<string, string>;
}

// The form fields a booking needs, with the words a passenger sees for each.
const FIELD_LABELS = [
  ["name", "name"],
  ["email", "email"],
  ["sailing_id", "sailing"],
  ["vehicle", "vehicle"],
  ["card", "card number"],
];

async function createBooking(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  for (const [field, label] of FIELD_LABELS) {
    if (!body[field]) return json(400, { ok: false, error: `Enter your ${label}.` });
  }
  const span = trace.getActiveSpan();
  span?.setAttribute("passenger.email", body.email);
  const sailing = await store.sailing(Number(body.sailing_id));
  if (!sailing)
    return json(404, {
      ok: false,
      error: "That sailing is not on the timetable. Pick another sailing.",
    });
  const ref = newRef();
  span?.setAttribute("booking.ref", ref);
  fares.refresh();
  const pence = fares.price(sailing.route_from, sailing.route_to, body.vehicle);
  if (pence === 0) {
    const journey = `${sailing.route_from} to ${sailing.route_to} ${body.vehicle}`;
    log("error", `booking failed: no fare for ${journey} (fares ${fares.version})`, {
      "booking.ref": ref,
    });
    return json(500, {
      ok: false,
      error: "We could not price this sailing. Try again in a few minutes.",
    });
  }
  if (String(body.card).endsWith("0002")) {
    log("warn", `card declined by payments gateway: do_not_honor for booking ${ref}`, {
      "booking.ref": ref,
    });
    return json(402, { ok: false, error: "your card was declined" });
  }
  if (RELEASE === "v2" && store.system === "postgresql") await auditTrail(ref);
  // biome-ignore-start lint/style/useNamingConvention: these are database column names.
  const booking: Booking = {
    ref,
    sailing_id: sailing.id,
    name: body.name,
    email: body.email.toLowerCase(),
    vehicle: body.vehicle,
    fare_pence: pence,
    status: "confirmed",
    created_at: new Date().toISOString(),
  };
  // biome-ignore-end lint/style/useNamingConvention: these are database column names.
  await store.insertBooking(booking);
  const sailingName = `${sailing.departs} ${sailing.route_from} to ${sailing.route_to}`;
  log("info", `booking confirmed ${ref} on the ${sailingName} for ${booking.email}`, {
    "booking.ref": ref,
  });
  // biome-ignore lint/style/useNamingConvention: the booking page reads this snake_case field.
  return json(200, { ok: true, ref, fare_pence: pence, departs: sailing.departs });
}

async function checkIn(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const ref = String(body.ref ?? "")
    .trim()
    .toUpperCase();
  trace.getActiveSpan()?.setAttribute("booking.ref", ref);
  const problem = await hooks.checkin.validateCheckin(ref, store);
  if (problem) {
    log("warn", `check-in refused for ${ref}: ${problem}`, { "booking.ref": ref });
    return json(409, { ok: false, error: problem });
  }
  await store.checkIn(ref);
  log("info", `checked in ${ref}`, { "booking.ref": ref });
  return json(200, { ok: true, ref });
}

async function timetable(url: URL): Promise<Response> {
  const route = url.searchParams.get("route") ?? "port-maren";
  const days = url.searchParams.get("days") ?? "1";
  const query = `route=${encodeURIComponent(route)}&days=${encodeURIComponent(days)}`;
  const timeout = Number(env.TIMETABLE_TIMEOUT_MS ?? 5000);
  return tracer.startActiveSpan(
    "GET timetable-loader /tides",
    { kind: SpanKind.CLIENT },
    async (span) => {
      const headers: Record<string, string> = {};
      propagation.inject(context.active(), headers);
      try {
        const response = await fetch(`${TIMETABLE_URL}/tides?${query}`, {
          headers,
          signal: AbortSignal.timeout(timeout),
        });
        span.setAttribute("http.response.status_code", response.status);
        return json(response.status, await response.json());
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        log("error", `timetable-loader did not answer: ${(err as Error).message}`);
        return json(504, {
          ok: false,
          error: "The timetable is not available right now. Try again in a few minutes.",
        });
      } finally {
        span.end();
      }
    },
  );
}

type Handler = () => Promise<Response>;

const htmlHeaders = { "content-type": "text/html" };

async function homePage(): Promise<Response> {
  fares.refresh();
  const page = bookingPage(await store.sailings(), RELEASE, fares.version);
  return new Response(page, { headers: htmlHeaders });
}

async function checkinPageResponse(): Promise<Response> {
  return new Response(checkinPage(RELEASE, fares.version), { headers: htmlHeaders });
}

async function health(): Promise<Response> {
  await store.ping();
  return json(200, { ok: true, release: RELEASE });
}

async function flushTelemetry(): Promise<Response> {
  await telemetry.flush();
  return json(200, { ok: true });
}

// Picks the handler for a request. The path it returns names the span, so unknown paths
// keep their own name.
async function route(request: Request, url: URL): Promise<[string, Handler]> {
  const routes: Record<string, Handler> = {
    "GET /": homePage,
    "GET /checkin": checkinPageResponse,
    "POST /api/bookings": () => createBooking(request),
    "POST /api/checkin": () => checkIn(request),
    "GET /timetable": () => timetable(url),
    "GET /health": health,
    "POST /telemetry/flush": flushTelemetry,
  };
  const handler = routes[`${request.method} ${url.pathname}`];
  if (handler) return [url.pathname, handler];
  return [url.pathname, async () => json(404, { ok: false, error: "not found" })];
}

// One access log line per request, like a web server writes.
function logAccess(request: Request, bunServer: Server, url: URL, path: string): void {
  const userAgent = request.headers.get("user-agent") ?? "";
  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientAddress = forwardedFor ?? bunServer.requestIP(request)?.address ?? "";
  const line = `${clientAddress} "${request.method} ${url.pathname}" "${userAgent}"`;
  log("info", line, { "http.route": path });
}

const server = Bun.serve({
  port: Number(env.PORT ?? 8000),
  hostname: env.HOST ?? "0.0.0.0",
  async fetch(request, bunServer) {
    const url = new URL(request.url);
    const [path, handler] = await route(request, url);
    const incomingHeaders = Object.fromEntries(request.headers);
    const parent = propagation.extract(context.active(), incomingHeaders);
    return tracer.startActiveSpan(
      `${request.method} ${path}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          "http.request.method": request.method,
          "http.route": path,
          "url.path": url.pathname,
        },
      },
      parent,
      async (span) => {
        if (path !== "/health") logAccess(request, bunServer, url, path);
        try {
          const response = await handler();
          span.setAttribute("http.response.status_code", response.status);
          if (response.status >= 500) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` });
          }
          return response;
        } catch (err) {
          const message = (err as Error).message;
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message });
          span.setAttribute("http.response.status_code", 500);
          log("error", `${request.method} ${path} failed: ${message}`);
          return json(500, {
            ok: false,
            error: "The booking did not go through. Try again in a few minutes.",
          });
        } finally {
          span.end();
        }
      },
    );
  },
});

log("info", `booking-web release ${RELEASE} listening on ${server.port}`);
