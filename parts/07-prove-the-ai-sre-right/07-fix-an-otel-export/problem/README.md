# Fix an OTel export

## The problem

The AI SRE can only reason about data it can read. A service with no name and plain span names gives it nothing to work with. For example, a span named only GET tells nobody which page was slow.

## Watch it done

The starter export has four faults. The service name is `unknown_service`. There is no version. A span is named only `GET`. An email sits in an attribute.

The solution fixes all four.

```mermaid
flowchart LR
  S[your service] -->|OTLP| E[otel-export.json]
  E --> B[backend and the AI SRE]
```

## Your turn

OTel is the open standard for sending traces, metrics and logs. OTLP is the format it uses to send that data. A **resource** is a set of facts about the service, such as its name and version. A **span** is one timed piece of work inside a trace.

Open `otel-export.json` in this folder.

1. Set the `service.name` to a real name.
2. Add a `service.version` next to it.
3. Rename the span `GET` after its route, such as `GET /checkin`.
4. Remove the email attribute.

## Do it on your work

This step fixes a file we give you, so it cannot prove the data is yours. To use it on your own service, set `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES` for it. Make one request that calls a second service or a database.

Save what it exports. Copy that file over `otel-export.json`, and run the same seven rules on it. Good looks like this: the backend shows your service name, your release, and one trace with a parent and a child.

## Done when

- The service has a name and a version.
- The ids and span names look right.
- No email address is in the data.

```bash
bun run verify fix-an-otel-export
```

Expect: `Done. All 7 rules pass.` and a `Progress:` line.

## Solution

The finished export is in `solution/otel-export.json`. Compare it with your file to see the four fixes.

## If you get stuck

| What you see                          | Fix                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `FAIL service.name is set`            | Change the `service.name` value in the file. It must not start with `unknown_service`.      |
| `FAIL service.version is set`         | Add a second resource attribute with the key `service.version`. Copy the shape of the name. |
| `FAIL at least one span has a parent` | Keep the child span's `parentSpanId`. It must match the `spanId` of the span above it.      |

## Words you will use

- **OTLP**: the format OTel uses to send data.
- **Resource**: facts about the service, such as its name and version.
- **Span**: one timed piece of work inside a trace.
