-- Sorts the wrong way: ORDER BY Duration with no DESC puts the fastest booking first.
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
        AND Timestamp > now() - INTERVAL 15 MINUTE
    ORDER BY Duration ASC
    LIMIT 1
)
ORDER BY Timestamp
