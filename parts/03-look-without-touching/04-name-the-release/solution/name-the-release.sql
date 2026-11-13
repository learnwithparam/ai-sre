-- Booking requests and failures for each release of booking-web, worst release first.
SELECT
    ResourceAttributes['service.version'] AS release,
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
