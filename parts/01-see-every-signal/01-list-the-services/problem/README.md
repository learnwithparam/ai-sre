# List the services

## The problem

You get paged at Gullrock Ferries. A page is an alert that calls the person on call. Your first questions are simple. Which services are running? How busy is each one? Which one is failing?

You want to answer all three with one query. Without that answer, every later step is a guess.

ClickStack stores the telemetry: the data that services send about their own work. It keeps every span in one ClickHouse table, `otel_traces`. ClickHouse is a database made for very large tables. One row in `otel_traces` is one span. A span is one piece of timed work, such as one HTTP request or one SQL statement.

For example, this is what the finished query prints on the recorded bad-release morning:

```text
service            spans   error_spans
booking-web         7173           131
timetable-loader     196             0
```

booking-web is the busiest service. It is also the only one with failed spans.

![The finished query in HyperDX's SQL view](../images/expected.png)

## Your challenge

Open `list-the-services.sql` in this folder. Write one SELECT over `otel_traces`. It looks at the last 60 minutes and returns these columns:

| Column        | Meaning                                        |
| ------------- | ---------------------------------------------- |
| `service`     | the service that sent the span (`ServiceName`) |
| `spans`       | how many spans it sent                         |
| `error_spans` | how many of them failed (`StatusCode`)         |

Put the busiest service first.

Try your query in HyperDX before you run the check. HyperDX is the web screen of ClickStack. Open http://localhost:8080, choose SQL, and run your query there.

## Done when

- The file holds one SELECT, and it runs.
- It returns the columns `service`, `spans` and `error_spans`, with one row per service.
- The busiest service is the first row, and the counts match the telemetry.

```bash
bun run verify list-the-services
```

Expect: `Done. All 7 rules pass.` and a `Progress:` line.

When the world is up, the check runs your query against the live world. In CI, it uses a recorded morning at Gullrock instead. CI is the robot that runs every check when someone pushes code. The recording plays back so that it ends at the moment you query it.

## If you get stuck

Each FAIL line tells you what to try next. For example, a query that writes `'ERROR'` in capital letters gets this:

```text
  FAIL  span and error counts match the telemetry
        Try next: count spans with count() and errors with countIf(StatusCode = 'Error'); the value is case sensitive, so look at one row first
```

| What you see                       | Fix                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `FAIL the query runs`              | Paste the query into the SQL view of HyperDX. It shows the full ClickHouse error.                                 |
| `FAIL one row per service`         | Add `GROUP BY service`. Without it, you get one row for each span.                                                |
| `FAIL span and error counts match` | Look at the values first: `SELECT DISTINCT StatusCode FROM otel_traces` prints `Unset` and `Error`. Case matters. |

## Words you will use

- **Span**: one piece of timed work, such as one request or one SQL statement. It has a name, a duration and a status.
- **Trace**: all the spans of one request across every service. One trace id links them.
- **countIf**: a ClickHouse function. It counts only the rows where a condition is true.
