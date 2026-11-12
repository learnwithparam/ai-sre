// booking-web: Gullrock Ferries' booking site. Book a sailing, pay, check in at the quay.
import { context, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { Fares } from "./fares";
import { loadHooks, log, startTelemetry } from "./otel";
import { bookingPage, checkinPage } from "./pages";
import { Store, type Booking } from "./store";

const env = process.env;
const RELEASE = env.BOOKING_RELEASE ?? "v1";
const FAULT_CODE = env.FAULT_CODE ?? "";
const hooks = await loadHooks(env);
const telemetry = startTelemetry(hooks, env);
const tracer = trace.getTracer("booking-web");
const store = new Store(env.DATABASE_URL ?? "sqlite://:memory:");
await store.migrate();
const fares = new Fares(env.FARES_FILE ?? new URL("../../config/fares/fares-41.json", import.meta.url).pathname, FAULT_CODE);
const TIMETABLE_URL = env.TIMETABLE_URL ?? "http://localhost:8001";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const newRef = () => "GR-" + Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

// Release v2 added an audit trail that opens its own database connection for every booking and
// holds it for a slow write. Only two such connections may be open at once.
const AUDIT_SLOTS = 2;
let auditInUse = 0;
async function auditTrail(ref: string): Promise<void> {
  const started = Date.now();
  while (auditInUse >= AUDIT_SLOTS) {
    if (Date.now() - started > 300) {
      const ref2 = FAULT_CODE ? ` ref=${FAULT_CODE}` : "";
      throw new Error(`connection pool exhausted: ${AUDIT_SLOTS} of ${AUDIT_SLOTS} connections in use (audit_trail)${ref2}`);
    }
    await Bun.sleep(20);
  }
  auditInUse++;
  try {
    await store.query("INSERT audit_trail", "SELECT pg_sleep(1.5); INSERT INTO audit_trail ...", async () => {
      const { SQL } = await import("bun");
      const conn = new SQL(env.DATABASE_URL!, { max: 1 }); // a fresh connection per booking: the defect
      try { await conn`SELECT pg_sleep(1.5)`; } finally { await conn.close(); }
    });
  } finally {
    auditInUse--;
  }
  void ref;
}

async function createBooking(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  for (const field of ["name", "email", "sailing_id", "vehicle", "card"]) {
    if (!body[field]) return json(400, { ok: false, error: `missing ${field}` });
  }
  const span = trace.getActiveSpan();
  span?.setAttribute("passenger.email", body.email);
  const sailing = await store.sailing(Number(body.sailing_id));
  if (!sailing) return json(404, { ok: false, error: "no such sailing" });
  const ref = newRef();
  span?.setAttribute("booking.ref", ref);
  fares.refresh();
  const pence = fares.price(sailing.route_from, sailing.route_to, body.vehicle);
  if (pence === 0) {
    log("error", `booking failed: no fare for ${sailing.route_from} to ${sailing.route_to} ${body.vehicle} (fares ${fares.version})`, { "booking.ref": ref });
    return json(500, { ok: false, error: "we could not price this sailing, please try again" });
  }
  if (String(body.card).endsWith("0002")) {
    log("warn", `card declined by payments gateway: do_not_honor for booking ${ref}`, { "booking.ref": ref });
    return json(402, { ok: false, error: "your card was declined" });
  }
  if (RELEASE === "v2" && store.system === "postgresql") await auditTrail(ref);
  const booking: Booking = {
    ref, sailing_id: sailing.id, name: body.name, email: body.email.toLowerCase(), vehicle: body.vehicle,
    fare_pence: pence, status: "confirmed", created_at: new Date().toISOString(),
  };
  await store.insertBooking(booking);
  log("info", `booking confirmed ${ref} on the ${sailing.departs} ${sailing.route_from} to ${sailing.route_to} for ${booking.email}`, {
    "booking.ref": ref,
  });
  return json(200, { ok: true, ref, fare_pence: pence, departs: sailing.departs });
}

async function checkIn(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  const ref = String(body.ref ?? "").trim().toUpperCase();
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
  return tracer.startActiveSpan("GET timetable-loader /tides", { kind: SpanKind.CLIENT }, async (span) => {
    const headers: Record<string, string> = {};
    propagation.inject(context.active(), headers);
    try {
      const res = await fetch(`${TIMETABLE_URL}/tides?route=${encodeURIComponent(route)}&days=${encodeURIComponent(days)}`, {
        headers, signal: AbortSignal.timeout(Number(env.TIMETABLE_TIMEOUT_MS ?? 5000)),
      });
      span.setAttribute("http.response.status_code", res.status);
      return json(res.status, await res.json());
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      log("error", `timetable-loader did not answer: ${(err as Error).message}`);
      return json(504, { ok: false, error: "the timetable is not available right now" });
    } finally {
      span.end();
    }
  });
}

async function route(req: Request, url: URL): Promise<[string, () => Promise<Response>]> {
  const m = req.method;
  if (m === "GET" && url.pathname === "/") return ["/", async () => {
    fares.refresh();
    return new Response(bookingPage(await store.sailings(), RELEASE, fares.version), { headers: { "content-type": "text/html" } });
  }];
  if (m === "GET" && url.pathname === "/checkin") return ["/checkin", async () => new Response(checkinPage(RELEASE, fares.version), { headers: { "content-type": "text/html" } })];
  if (m === "POST" && url.pathname === "/api/bookings") return ["/api/bookings", () => createBooking(req)];
  if (m === "POST" && url.pathname === "/api/checkin") return ["/api/checkin", () => checkIn(req)];
  if (m === "GET" && url.pathname === "/timetable") return ["/timetable", () => timetable(url)];
  if (m === "GET" && url.pathname === "/health") return ["/health", async () => { await store.ping(); return json(200, { ok: true, release: RELEASE }); }];
  if (m === "POST" && url.pathname === "/telemetry/flush") return ["/telemetry/flush", async () => { await telemetry.flush(); return json(200, { ok: true }); }];
  return [url.pathname, async () => json(404, { ok: false, error: "not found" })];
}

const server = Bun.serve({
  port: Number(env.PORT ?? 8000),
  hostname: env.HOST ?? "0.0.0.0",
  async fetch(req, srv) {
    const url = new URL(req.url);
    const [path, handler] = await route(req, url);
    const parent = propagation.extract(context.active(), Object.fromEntries(req.headers));
    return tracer.startActiveSpan(`${req.method} ${path}`, {
      kind: SpanKind.SERVER,
      attributes: { "http.request.method": req.method, "http.route": path, "url.path": url.pathname },
    }, parent, async (span) => {
      const ua = req.headers.get("user-agent") ?? "";
      const ip = req.headers.get("x-forwarded-for") ?? srv.requestIP(req)?.address ?? "";
      if (path !== "/health") log("info", `${ip} "${req.method} ${url.pathname}" "${ua}"`, { "http.route": path });
      try {
        const res = await handler();
        span.setAttribute("http.response.status_code", res.status);
        if (res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${res.status}` });
        return res;
      } catch (err) {
        const message = (err as Error).message;
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        span.setAttribute("http.response.status_code", 500);
        log("error", `${req.method} ${path} failed: ${message}`);
        return json(500, { ok: false, error: "something went wrong, please try again" });
      } finally {
        span.end();
      }
    });
  },
});

log("info", `booking-web release ${RELEASE} listening on ${server.port}`);
