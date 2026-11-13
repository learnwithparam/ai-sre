// Which service is this, and which release of it? Every span and log line carries these attributes.
import { type Resource, resourceFromAttributes } from "@opentelemetry/resources";

export function bookingResource(env: Record<string, string | undefined>): Resource {
  return resourceFromAttributes({
    "service.name": "booking-web",
    "service.version": env.BOOKING_RELEASE ?? "unknown",
    "deployment.environment.name": env.GULLROCK_ENV ?? "harbour-lab",
  });
}
