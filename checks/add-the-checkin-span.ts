// add-the-checkin-span: a passenger books, then checks in. The check-in trace must hold a span
// named checkin.validate, inside the POST /api/checkin request, carrying the booking reference.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import { once, startBooking } from "./lib/booking";
import type { SpanRow } from "./lib/otlp";

type Session = { up: boolean; ref: string; ok: number; refused: number; spans: SpanRow[] };

async function session(folder: string): Promise<Session> {
  return once(`checkin:${folder}`, async () => {
    const booking = await startBooking(folder);
    try {
      if (!booking.up) return { up: false, ref: "", ok: 0, refused: 0, spans: [] };
      const ref = (await booking.book()).json?.ref ?? "";
      const ok = (await booking.call("POST", "/api/checkin", { ref })).status;
      const unknownRef = { ref: "GR-NOSUCH" };
      const refused = (await booking.call("POST", "/api/checkin", unknownRef)).status;
      await booking.flush();
      return { up: true, ref, ok, refused, spans: [...booking.spans] };
    } finally {
      await booking.stop();
    }
  });
}

function validateSpans(run: Session): SpanRow[] {
  return run.spans.filter(
    (span) => span.name === "checkin.validate" && span.attributes["booking.ref"] === run.ref,
  );
}

function hasCheckinParent(run: Session, child: SpanRow): boolean {
  return run.spans.some(
    (parent) =>
      parent.spanId === child.parentSpanId &&
      parent.traceId === child.traceId &&
      parent.name === "POST /api/checkin",
  );
}

export default [
  {
    says: "booking-web starts with your checkin.ts",
    // booking-web uses the finished file when yours is missing, so a missing file must fail here.
    test: async (folder) => existsSync(join(folder, "checkin.ts")) && (await session(folder)).up,
    tryNext:
      "from the repo root, run PORT=8100 " +
      "BOOKING_HOOKS_DIR=parts/01-see-every-signal/03-add-the-checkin-span/problem " +
      "bun world/booking-web/src/server.ts " +
      "and read the error it prints",
  },
  {
    says: "check-in still works, and an unknown reference is refused",
    test: async (folder) => {
      const run = await session(folder);
      return run.ok === 200 && run.refused === 409;
    },
    tryNext:
      "return the same messages as before from inside the span; " +
      "return null when the booking can check in",
  },
  {
    says: "a span named checkin.validate is exported",
    test: async (folder) => {
      const run = await session(folder);
      return run.spans.some((span) => span.name === "checkin.validate");
    },
    tryNext:
      'wrap the lookup in tracer.startActiveSpan("checkin.validate", ...) ' +
      "and call span.end() in a finally block",
  },
  {
    says: "the span carries booking.ref with the reference being checked in",
    test: async (folder) => validateSpans(await session(folder)).length > 0,
    tryNext: 'call span.setAttribute("booking.ref", ref) before the lookup',
  },
  {
    says: "the span sits inside the POST /api/checkin request",
    test: async (folder) => {
      const run = await session(folder);
      return validateSpans(run).some((span) => hasCheckinParent(run, span));
    },
    tryNext:
      "use startActiveSpan from the active context; " +
      "a span started with ROOT_CONTEXT begins a new trace",
  },
] satisfies Rule[];
