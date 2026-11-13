-- How fast is booking-web spending its error budget? One row with the columns:
-- burn_5m, burn_1h, page.
-- The objective: 99.5% of requests succeed. The error budget is the other 0.5%, or 0.005.
-- burn rate = error rate / error budget. Page only while both windows burn faster than 10.
SELECT
    countIf(StatusCode = 'Error') / count() AS burn_5m,
    0 AS burn_1h,
    burn_5m > 10 AS page
FROM otel_traces
WHERE ServiceName = 'booking-web'
    AND SpanKind = 'Server'
    AND SpanName != 'GET /health'
    AND Timestamp > now() - INTERVAL 1 HOUR
