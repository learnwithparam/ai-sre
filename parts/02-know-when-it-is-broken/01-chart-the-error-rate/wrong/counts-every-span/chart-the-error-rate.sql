-- Counts every span, not only requests. One booking makes four spans, so the rate looks small.
SELECT
    toStartOfInterval(Timestamp, INTERVAL 10 SECOND) AS bucket,
    count() AS requests,
    countIf(StatusCode = 'Error') AS errors,
    errors / requests AS error_rate
FROM otel_traces
WHERE ServiceName = 'booking-web'
    AND Timestamp > now() - INTERVAL 15 MINUTE
GROUP BY bucket
ORDER BY bucket
