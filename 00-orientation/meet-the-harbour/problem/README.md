# Meet the harbour

## The problem

You cannot judge an AI SRE on a system you have never seen working. So before anything breaks, you follow one booking. It goes from the booking page to a row in the bookings table. Then you watch the finished loop fix a fault once.

A trace is the record of one request as it moves through the services. Each trace is made of spans, and a span is one piece of work, such as one database call. Every span in a trace shares the same trace id.

![The booking page after Book and pay, with the reference and the release in the footer](../images/expected.png)

## Your challenge

1. Book the 08:15 Port Maren to Gullrock sailing with a car on http://localhost:8000.
2. In HyperDX, find the `POST /api/bookings` trace that made your booking.
3. Fill in `answers.md` in this folder:

```
Booking reference: GR-XXXXXX
Trace id: 32 lower-case hex characters from HyperDX
```

4. Run the finished loop: `bun run demo bad-release`, `bun run approve --yes`, `bun run demo finish`.

For example, the sample solution booked a sailing and got the reference `GR-CTZPCM`. In HyperDX, its `POST /api/bookings` trace had the id `b2fc93d8894696a202c4d28649297fe6`. So its `answers.md` says:

```text
Booking reference: GR-CTZPCM
Trace id: b2fc93d8894696a202c4d28649297fe6
```

Your own reference and trace id are different. Use the ones from your booking.

## Done when

- `answers.md` names a booking reference and a trace id.
- The booking is a row in the bookings table.
- The trace is the `POST /api/bookings` request that made that booking.
- The audit log shows a human approval, then the change, then verified recovery.

```bash
bun run verify meet-the-harbour
```

Expect: `Done. All 4 rules pass.` and a `Progress:` line.

## If you get stuck

| What you see                                                  | Fix                                                                                                                                |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `FAIL the booking is a row in the bookings table`             | Copy the reference exactly as the page showed it, such as `GR-7KQ2MD`.                                                             |
| `FAIL the trace exists and is the POST /api/bookings request` | In HyperDX search for the reference, open the trace whose root span is `POST /api/bookings`, and copy the Trace ID, not a Span ID. |
| `FAIL the finished loop ran`                                  | Run the three demo commands in order; `bun run demo finish` waits for verification.                                                |

## Words you will use

- **Trace id**: the id that every span of one request shares. HyperDX shows it on the trace panel.
- **Incident**: a page (an alert to the on-call engineer) that harbour-control's detector opens. It opens one when a signal crosses its limit.
- **Audit log**: the table `sre.incident_events`. Rows are only added, never changed. Every finding, proposal, approval and run is a row.
