-- How many booking-web requests failed in each 10 second bucket?
-- One SELECT over otel_traces. Columns: bucket, requests, errors, error_rate.
-- A request is a booking-web span of kind Server. Leave out GET /health.
-- error_rate is a fraction between 0 and 1. Oldest bucket first. Last 15 minutes.
SELECT
    toStartOfInterval(Timestamp, INTERVAL 10 SECOND) AS bucket,
    count() AS requests
FROM otel_traces
GROUP BY bucket
ORDER BY bucket
