# Open the slowest trace

## The problem

The new pattern says "connection pool exhausted". booking-web has only two database connections. Something holds them too long. A count cannot say what. One trace can.

A trace is every span of one request. Each span shows where its time went. For example, a failed booking waited about 300 ms for a free connection, then gave up:

```text
span                  duration_ms   status
POST /api/bookings          316.9   Error
SELECT sailings               0.5   Unset
```

## Watch it done

The failed bookings are the victims. The slowest booking that worked shows who holds the connections. This is every span of that booking:

![Every span of the slowest booking](../images/expected.png)

## Your turn

1. Open `open-the-slowest-trace.sql`. The outer SELECT lists every span of one trace. The inner SELECT, in brackets, picks the trace.
2. Change the inner SELECT so it picks the slowest `POST /api/bookings` of the last `15 minutes`. Right now it picks any booking.
3. Run the query and read the spans. Which one takes the most time?

`Duration` is in nanoseconds. The starter divides it by 1e6, so `duration_ms` is in milliseconds.

4. Optional: on the live world, paste the trace id into HyperDX's search. It shows the same spans as a waterfall.

## Do it on your work

Find the slowest request of your own service in a recent stretch of traffic. Read its spans. Good looks like: you name the span that takes the most time, and you can say why it is slow.

## Done when

- Every row belongs to one trace: the slowest booking of the last `15 minutes`.
- The rows list every span of that trace.
- One of them is `INSERT audit_trail`, and it takes more than 1 second.

```bash
bun run verify open-the-slowest-trace
```

Expect: `Done. All 7 rules pass.` and a `Progress:` line.

The check runs your query on the recorded bad-release morning.

## Solution

The finished query is in `solution/open-the-slowest-trace.sql`.

## If you get stuck

Sorting by `Duration` with no DESC puts the fastest booking first. The check prints:

```text
  FAIL  the trace is the slowest booking of the last 15 minutes
        Try next: in the inner SELECT, add ORDER BY Duration DESC before LIMIT 1; DESC puts the slowest first
```

| What you see                             | Fix                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `FAIL every row belongs to one trace`    | Keep `LIMIT 1` at the end of the inner SELECT.                                         |
| `FAIL it shows the slow span`            | Do not filter on `StatusCode`. The slowest failed booking never reached the slow span. |
| `FAIL it lists every span of that trace` | Do not filter the outer SELECT on `SpanName`.                                          |

## Words you will use

- **Trace**: every span of one request, across every service. One trace id links them.
- **Waterfall**: a trace drawn as bars, one per span, so you see where the time went.
- **Connection pool**: a small set of open database connections that requests share.
