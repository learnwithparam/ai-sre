-- booking-web requests per 10 second bucket, how many failed, and the error rate.
SELECT
    toStartOfInterval(Timestamp, INTERVAL 10 SECOND) AS bucket,
    count() AS requests,
    countIf(StatusCode = 'Error') AS errors,
    errors / requests AS error_rate
FROM otel_traces
WHERE ServiceName = 'booking-web'
    AND SpanKind = 'Server'
    AND SpanName != 'GET /health'
    AND Timestamp > now() - INTERVAL 15 MINUTE
GROUP BY bucket
ORDER BY bucket
