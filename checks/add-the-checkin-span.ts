// add-the-checkin-span: a passenger books, then checks in. The check-in trace must hold a span named
// checkin.validate, inside the POST /api/checkin request, carrying the booking reference.
import type { Rule } from "../scripts/verify";
import { once, startBooking } from "./lib/booking";

async function session(dir: string) {
  return once(`checkin:${dir}`, async () => {
    const b = await startBooking(dir);
    try {
      if (!b.up) return { up: false, ref: "", ok: 0, refused: 0, spans: [] as typeof b.spans };
      const ref = (await b.book()).json?.ref ?? "";
      const ok = (await b.call("POST", "/api/checkin", { ref })).status;
      const refused = (await b.call("POST", "/api/checkin", { ref: "GR-NOSUCH" })).status;
      await b.flush();
      return { up: true, ref, ok, refused, spans: [...b.spans] };
    } finally { await b.stop(); }
  });
}
const validate = (s: Awaited<ReturnType<typeof session>>) => s.spans.filter((x) => x.name === "checkin.validate" && x.attributes["booking.ref"] === s.ref);

export default [
  { says: "booking-web starts with your checkin.ts", test: async (d) => (await session(d)).up, tryNext: "run bun world/booking-web/src/server.ts with BOOKING_HOOKS_DIR set to this folder and read the error" },
  {
    says: "check-in still works, and an unknown reference is refused",
    test: async (d) => { const s = await session(d); return s.ok === 200 && s.refused === 409; },
    tryNext: "return the same messages as before from inside the span; return null when the booking can check in",
  },
  {
    says: "a span named checkin.validate is exported",
    test: async (d) => (await session(d)).spans.some((x) => x.name === "checkin.validate"),
    tryNext: "wrap the lookup in tracer.startActiveSpan(\"checkin.validate\", ...) and call span.end() in a finally block",
  },
  {
    says: "the span carries booking.ref with the reference being checked in",
    test: async (d) => validate(await session(d)).length > 0,
    tryNext: "call span.setAttribute(\"booking.ref\", ref) before the lookup",
  },
  {
    says: "the span sits inside the POST /api/checkin request",
    test: async (d) => {
      const s = await session(d);
      return validate(s).some((v) => s.spans.some((p) => p.spanId === v.parentSpanId && p.traceId === v.traceId && p.name === "POST /api/checkin"));
    },
    tryNext: "use startActiveSpan from the active context; a span started with ROOT_CONTEXT begins a new trace",
  },
] satisfies Rule[];
