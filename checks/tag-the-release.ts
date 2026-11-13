// tag-the-release: booking-web runs with the learner's telemetry.ts under a release name the
// learner cannot guess. Every exported span must say which release served it.
import type { Rule } from "../scripts/verify";
import { once, startBooking } from "./lib/booking";
import type { SpanRow } from "./lib/otlp";

const RELEASE = "v7";

type Session = { up: boolean; spans: SpanRow[] };

async function session(folder: string): Promise<Session> {
  return once(`tag-the-release:${folder}`, async () => {
    const booking = await startBooking(folder, RELEASE);
    try {
      if (!booking.up) return { up: false, spans: [] };
      await booking.call("GET", "/");
      const booked = await booking.book();
      await booking.call("POST", "/api/checkin", { ref: booked.json?.ref });
      await booking.flush();
      return { up: true, spans: [...booking.spans] };
    } finally {
      await booking.stop();
    }
  });
}

function hasVersion(span: SpanRow): boolean {
  const version = span.resource["service.version"];
  return typeof version === "string" && version !== "";
}

export default [
  {
    says: "booking-web starts with your telemetry.ts",
    test: async (folder) => (await session(folder)).up,
    tryNext:
      "run bun world/booking-web/src/server.ts with BOOKING_HOOKS_DIR set to this folder " +
      "and read the error it prints",
  },
  {
    says: "spans reach the collector",
    test: async (folder) => (await session(folder)).spans.length >= 5,
    tryNext:
      "keep service.name in the resource; " +
      "return resourceFromAttributes({...}) from bookingResource",
  },
  {
    says: "every span carries the resource attribute service.version",
    test: async (folder) => {
      const { spans } = await session(folder);
      return spans.length > 0 && spans.every(hasVersion);
    },
    tryNext:
      "add the key service.version to the resource attributes in bookingResource, not to one span",
  },
  {
    says: `service.version names the release that is running (${RELEASE} in this check)`,
    test: async (folder) => {
      const { spans } = await session(folder);
      return (
        spans.length > 0 && spans.every((span) => span.resource["service.version"] === RELEASE)
      );
    },
    tryNext:
      "read the release from env.BOOKING_RELEASE; " +
      "a fixed value like v1 is wrong as soon as v2 ships",
  },
  {
    says: "service.name is still booking-web",
    test: async (folder) => {
      const { spans } = await session(folder);
      return (
        spans.length > 0 && spans.every((span) => span.resource["service.name"] === "booking-web")
      );
    },
    tryNext: 'keep "service.name": "booking-web" next to the new attribute',
  },
] satisfies Rule[];
