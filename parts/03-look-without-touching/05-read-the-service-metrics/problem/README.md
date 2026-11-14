# Read the service metrics

## The problem

A metric is a number over time. Requests, errors and slow answers are three of them. Alone, each can mislead. A count of errors looks big on a busy service. It looks small on a quiet one. So divide by the requests to get a rate. For example, 5 errors in 100 requests is a rate of 5 in 100.

```mermaid
flowchart LR
  M[metrics.csv] -->|errors / requests| R[error rate per service]
  R --> W[worst service]
  W --> F[first bad minute]
```

## Watch it done

For one service, add up the errors of the last five minutes and divide by the requests of the same five minutes. Do this for each service. The highest rate is the worst service.

## Your challenge

Open `answers/read-the-service-metrics.md` in this folder.

1. Read `metrics.csv`. It has a row per minute and service.
2. Find the error rate of each service over the last five minutes.
3. Write the worst service and its rate as a percent, such as `Error rate: 11%`.
4. Find the first minute where that service has more than five errors in a hundred requests.
5. Write one sentence after `Reading:` about what you would look at next.

```bash
bun run verify read-the-service-metrics
```

Expect: `Done. All 4 rules pass.` and a `Progress:` line.

## Do it on your work

Export one hour of requests and errors for your own service. Do the same sums. Good looks like this: you can say the first bad minute, and then check what changed at that minute.

## Done when

- The worst service is named.
- The rate is a percent within one point.
- The first bad minute is right, and you say what you look at next.

## If you get stuck

| What you see                       | Fix                                                       |
| ---------------------------------- | --------------------------------------------------------- |
| `FAIL the error rate is a percent` | Divide errors by requests, then write it with a `%` sign. |
| `FAIL the first bad minute`        | Look at one service only, and scan its rows from the top. |

## Words you will use

- **Metric**: a number that is measured again and again over time.
- **Error rate**: errors divided by requests.
- **Window**: a stretch of time you look at, such as the last five minutes.
