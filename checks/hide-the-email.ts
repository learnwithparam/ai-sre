// hide-the-email: passengers book with real-looking emails. No email may leave booking-web in a
// span attribute or a log line, and the spans must still say what happened.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import { once, startBooking } from "./lib/booking";
import { EMAIL } from "./lib/files";
import type { LogRow, SpanRow } from "./lib/otlp";

type Session = { up: boolean; booked: number; spans: SpanRow[]; logs: LogRow[] };

const PASSENGER_EMAILS = [
  "ana@example.test",
  "Callum.Reid+ferry@island-mail.co.uk",
  "m.sinclair@gullrock.test",
];

async function session(folder: string): Promise<Session> {
  return once(`hide:${folder}`, async () => {
    const booking = await startBooking(folder);
    try {
      if (!booking.up) return { up: false, booked: 0, spans: [], logs: [] };
      let booked = 0;
      for (const email of PASSENGER_EMAILS) {
        if ((await booking.book(email)).status === 200) booked++;
      }
      await booking.flush();
      return { up: true, booked, spans: [...booking.spans], logs: [...booking.logs] };
    } finally {
      await booking.stop();
    }
  });
}

function leaks(attributes: Record<string, unknown>): boolean {
  return Object.values(attributes).some((value) => EMAIL.test(String(value)));
}

function logLeaks(log: LogRow): boolean {
  return EMAIL.test(log.body) || leaks(log.attributes);
}

export default [
  {
    says: "booking-web starts with your redact.ts and takes bookings",
    // booking-web uses the finished file when yours is missing, so a missing file must fail here.
    test: async (folder) =>
      existsSync(join(folder, "redact.ts")) && (await session(folder)).booked === 3,
    tryNext:
      "from the repo root, run PORT=8100 " +
      "BOOKING_HOOKS_DIR=parts/01-see-every-signal/04-hide-the-email/problem " +
      "bun world/booking-web/src/server.ts " +
      "and read the error it prints",
  },
  {
    says: "no span attribute holds an email address",
    test: async (folder) => {
      const { spans } = await session(folder);
      return spans.length > 0 && !spans.some((span) => leaks(span.attributes));
    },
    tryNext:
      "in redactAttributes, replace every email inside string values; " +
      "passenger.email is one of them",
  },
  {
    says: "no log line or log attribute holds an email address",
    test: async (folder) => {
      const { logs } = await session(folder);
      return logs.length > 0 && !logs.some(logLeaks);
    },
    tryNext:
      "redactBody runs on every log line; the booking confirmed line names the passenger's email",
  },
  {
    says: "spans still say what happened (booking.ref and http.route survive)",
    test: async (folder) => {
      const { spans } = await session(folder);
      const hasRef = spans.some((span) =>
        String(span.attributes["booking.ref"] ?? "").startsWith("GR-"),
      );
      const hasRoute = spans.some((span) => span.attributes["http.route"] === "/api/bookings");
      return hasRef && hasRoute;
    },
    tryNext: "replace only the email text with [email]; keep every other attribute as it was",
  },
] satisfies Rule[];
