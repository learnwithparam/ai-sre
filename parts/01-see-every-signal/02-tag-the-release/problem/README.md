# Tag the release

## The problem

When booking errors climb, the first useful question is "what changed?". A span that does not say which release served it cannot answer that. At Gullrock, booking-web ships as releases `v1`, `v2` and so on, and today its spans name the service but not the release.

![A booking-web span in HyperDX with service.version in its resource attributes](../images/expected.png)

## Your challenge

Edit `telemetry.ts` in this folder. `bookingResource` builds the OpenTelemetry resource: the attributes that every span and log line from booking-web carries. Add the standard attribute `service.version`, set to the release that is running. The running release is in `env.BOOKING_RELEASE`.

To see your version live, run `bun run world try tag-the-release`, book a sailing on http://localhost:8000, and open the span in HyperDX. `bun run world try off` puts the finished version back.

## Done when

- booking-web starts with your `telemetry.ts` and its spans reach the collector.
- Every span carries the resource attribute `service.version`.
- It names the release that is running, whatever that release is called.
- `service.name` is still `booking-web`.

```bash
bun run verify tag-the-release
```

Expect: `Done. All 5 rules pass.` and a `Progress:` line.

## If you get stuck

| What you see                                                     | Fix                                                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `FAIL every span carries the resource attribute service.version` | The key is exactly `service.version`, a name OpenTelemetry defines.                                               |
| `FAIL service.version names the release that is running`         | Read the value from `env.BOOKING_RELEASE`. The check runs a release you cannot guess.                             |
| `FAIL booking-web starts with your telemetry.ts`                 | Run `BOOKING_HOOKS_DIR=$PWD bun ../../../../world/booking-web/src/server.ts` from this folder and read the error. |

## Words you will use

- **Resource**: the attributes that describe the process sending telemetry, attached to everything it sends.
- **Semantic conventions**: the attribute names OpenTelemetry defines, such as `service.name` and `service.version`, so every tool reads them the same way.
- **Release**: one deployed version of a service.
