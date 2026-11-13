-- Opens the slowest failed booking. It gave up after a short wait for a connection, so its
-- trace never reaches the slow INSERT that holds the connections.
SELECT
    TraceId AS trace_id,
    SpanName AS span,
    round(Duration / 1e6, 1) AS duration_ms,
    StatusCode AS status
FROM otel_traces
WHERE TraceId = (
    SELECT TraceId
    FROM otel_traces
    WHERE ServiceName = 'booking-web'
        AND SpanName = 'POST /api/bookings'
        AND StatusCode = 'Error'
        AND Timestamp > now() - INTERVAL 15 MINUTE
    ORDER BY Duration DESC
    LIMIT 1
)
ORDER BY Timestamp
