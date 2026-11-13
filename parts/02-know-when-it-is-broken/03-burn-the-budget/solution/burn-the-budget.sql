-- booking-web burn rate over the last 5 minutes and the last hour, and the page rule:
-- page only while both windows burn faster than 10.
WITH
    -- The objective: 99.5% of requests succeed. The error budget is the other 0.5%.
    0.005 AS error_budget,
    Timestamp > now() - INTERVAL 5 MINUTE AS in_last_5_minutes
SELECT
    countIf(StatusCode = 'Error' AND in_last_5_minutes) / countIf(in_last_5_minutes)
        / error_budget AS burn_5m,
    countIf(StatusCode = 'Error') / count() / error_budget AS burn_1h,
    burn_5m > 10 AND burn_1h > 10 AS page
FROM otel_traces
WHERE ServiceName = 'booking-web'
    AND SpanKind = 'Server'
    AND SpanName != 'GET /health'
    AND Timestamp > now() - INTERVAL 1 HOUR
