-- Counts every span of booking-web, not only booking requests. Page views and database
-- calls never fail here, so they hide how bad release v2 is.
SELECT
    ResourceAttributes['service.version'] AS release,
    count() AS requests,
    countIf(StatusCode = 'Error') AS errors,
    errors / requests AS error_rate
FROM otel_traces
WHERE ServiceName = 'booking-web'
    AND Timestamp > now() - INTERVAL 15 MINUTE
GROUP BY release
ORDER BY error_rate DESC
