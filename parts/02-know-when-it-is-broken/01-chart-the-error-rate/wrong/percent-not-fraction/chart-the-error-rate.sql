-- Writes the rate as a percent (0 to 100). Every later rule expects a fraction (0 to 1).
SELECT
    toStartOfInterval(Timestamp, INTERVAL 10 SECOND) AS bucket,
    count() AS requests,
    countIf(StatusCode = 'Error') AS errors,
    100 * errors / requests AS error_rate
FROM otel_traces
WHERE ServiceName = 'booking-web'
    AND SpanKind = 'Server'
    AND SpanName != 'GET /health'
    AND Timestamp > now() - INTERVAL 15 MINUTE
GROUP BY bucket
ORDER BY bucket
