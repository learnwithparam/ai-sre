// meet-the-harbour: the learner books a sailing, finds its trace in HyperDX, and runs the finished loop.
// The answers are checked against the bookings table, ClickHouse and harbour-control's audit log.
import type { Rule } from "../scripts/verify";
import { field, read } from "./lib/files";
import { bookingByRef, query } from "./lib/world";

const FILE = "answers.md";
const ref = (d: string) => field(read(d, FILE), "Booking reference").toUpperCase();
const traceId = (d: string) => field(read(d, FILE), "Trace id").toLowerCase();

export default [
  {
    says: `${FILE} names a booking reference and a trace id`,
    test: (d) => /^GR-[A-Z0-9]{6}$/.test(ref(d)) && /^[0-9a-f]{32}$/.test(traceId(d)),
    tryNext:
      "write two lines: Booking reference: GR-XXXXXX and Trace id: followed by the 32 characters HyperDX shows",
  },
  {
    says: "the booking is a row in the bookings table",
    test: async (d) => !!(await bookingByRef(d, ref(d))),
    tryNext:
      "copy the reference the booking page showed after Book and pay; check it with bun run world status running",
  },
  {
    says: "the trace exists and is the POST /api/bookings request that made that booking",
    test: async (d) =>
      (
        await query(
          d,
          "SELECT 1 FROM otel_traces WHERE TraceId = {t:String} AND SpanName = 'POST /api/bookings' AND SpanAttributes['booking.ref'] = {r:String} LIMIT 1",
          { t: traceId(d), r: ref(d) },
        )
      ).length === 1,
    tryNext:
      "in HyperDX search for the booking reference, open the POST /api/bookings trace, and copy its Trace ID",
  },
  {
    says: "the finished loop ran: a human approved a change, it ran, and recovery was verified",
    test: async (d) =>
      (
        await query(
          d,
          `SELECT incident_id FROM sre.incident_events GROUP BY incident_id
      HAVING minIf(ts, kind = 'remediation_approved') < minIf(ts, kind = 'remediation_executed')
         AND countIf(kind = 'remediation_approved') > 0 AND countIf(kind = 'verification_passed') > 0 LIMIT 1`,
        )
      ).length === 1,
    tryNext: "run bun run demo bad-release, then bun run approve --yes, then bun run demo finish",
  },
] satisfies Rule[];
