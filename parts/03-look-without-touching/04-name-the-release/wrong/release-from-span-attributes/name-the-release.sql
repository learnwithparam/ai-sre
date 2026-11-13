-- Looks for the release in SpanAttributes. It lives in ResourceAttributes, so every span
-- lands in one group with an empty release.
SELECT
    SpanAttributes['service.version'] AS release,
    count() AS requests,
    countIf(StatusCode = 'Error') AS errors,
    errors / requests AS error_rate
FROM otel_traces
WHERE ServiceName = 'booking-web'
    AND SpanKind = 'Server'
    AND SpanName = 'POST /api/bookings'
    AND Timestamp > now() - INTERVAL 15 MINUTE
GROUP BY release
ORDER BY error_rate DESC
