// tag-the-release: booking-web runs with the learner's telemetry.ts under a release name the learner
// cannot guess. Every exported span must say which release served it.
import type { Rule } from "../scripts/verify";
import { once, startBooking } from "./lib/booking";

const RELEASE = "v7";
async function session(dir: string) {
  return once(`tag-the-release:${dir}`, async () => {
    const b = await startBooking(dir, RELEASE);
    try {
      if (!b.up) return { up: false, spans: [] as typeof b.spans };
      await b.call("GET", "/");
      const booked = await b.book();
      await b.call("POST", "/api/checkin", { ref: booked.json?.ref });
      await b.flush();
      return { up: true, spans: [...b.spans] };
    } finally { await b.stop(); }
  });
}

export default [
  { says: "booking-web starts with your telemetry.ts", test: async (d) => (await session(d)).up, tryNext: "run bun world/booking-web/src/server.ts with BOOKING_HOOKS_DIR set to this folder and read the error it prints" },
  { says: "spans reach the collector", test: async (d) => (await session(d)).spans.length >= 5, tryNext: "keep service.name in the resource; return resourceFromAttributes({...}) from bookingResource" },
  {
    says: "every span carries the resource attribute service.version",
    test: async (d) => { const s = (await session(d)).spans; return s.length > 0 && s.every((x) => typeof x.resource["service.version"] === "string" && x.resource["service.version"] !== ""); },
    tryNext: "add the key service.version to the resource attributes in bookingResource, not to one span",
  },
  {
    says: `service.version names the release that is running (${RELEASE} in this check)`,
    test: async (d) => { const s = (await session(d)).spans; return s.length > 0 && s.every((x) => x.resource["service.version"] === RELEASE); },
    tryNext: "read the release from env.BOOKING_RELEASE; a fixed value like v1 is wrong as soon as v2 ships",
  },
  {
    says: "service.name is still booking-web",
    test: async (d) => { const s = (await session(d)).spans; return s.length > 0 && s.every((x) => x.resource["service.name"] === "booking-web"); },
    tryNext: "keep \"service.name\": \"booking-web\" next to the new attribute",
  },
] satisfies Rule[];
