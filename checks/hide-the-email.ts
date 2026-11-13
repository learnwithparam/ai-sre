// hide-the-email: passengers book with real-looking emails. No email may leave booking-web in a span
// attribute or a log line, and the spans must still say what happened.
import type { Rule } from "../scripts/verify";
import { once, startBooking } from "./lib/booking";
import { EMAIL } from "./lib/files";

async function session(dir: string) {
  return once(`hide:${dir}`, async () => {
    const b = await startBooking(dir);
    try {
      if (!b.up)
        return { up: false, booked: 0, spans: [] as typeof b.spans, logs: [] as typeof b.logs };
      let booked = 0;
      for (const email of [
        "ana@example.test",
        "Callum.Reid+ferry@island-mail.co.uk",
        "m.sinclair@gullrock.test",
      ])
        if ((await b.book(email)).status === 200) booked++;
      await b.flush();
      return { up: true, booked, spans: [...b.spans], logs: [...b.logs] };
    } finally {
      await b.stop();
    }
  });
}
const leaks = (o: Record<string, unknown>) => Object.values(o).some((v) => EMAIL.test(String(v)));

export default [
  {
    says: "booking-web starts with your redact.ts and takes bookings",
    test: async (d) => (await session(d)).booked === 3,
    tryNext:
      "run bun world/booking-web/src/server.ts with BOOKING_HOOKS_DIR set to this folder and read the error",
  },
  {
    says: "no span attribute holds an email address",
    test: async (d) => {
      const s = await session(d);
      return s.spans.length > 0 && !s.spans.some((x) => leaks(x.attributes));
    },
    tryNext:
      "in redactAttributes, replace every email inside string values; passenger.email is one of them",
  },
  {
    says: "no log line or log attribute holds an email address",
    test: async (d) => {
      const s = await session(d);
      return s.logs.length > 0 && !s.logs.some((l) => EMAIL.test(l.body) || leaks(l.attributes));
    },
    tryNext:
      "redactBody runs on every log line; the booking confirmed line names the passenger's email",
  },
  {
    says: "spans still say what happened (booking.ref and http.route survive)",
    test: async (d) => {
      const s = await session(d);
      return (
        s.spans.some((x) => String(x.attributes["booking.ref"] ?? "").startsWith("GR-")) &&
        s.spans.some((x) => x.attributes["http.route"] === "/api/bookings")
      );
    },
    tryNext: "replace only the email text with [email]; keep every other attribute as it was",
  },
] satisfies Rule[];
