-- Open the slowest booking of the last 15 minutes: list every span of its trace.
-- Columns: trace_id, span, duration_ms, status. One row per span, in the order they started.
-- The inner SELECT picks the trace. Right now it picks any booking, not the slowest one.
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
    LIMIT 1
)
ORDER BY Timestamp
