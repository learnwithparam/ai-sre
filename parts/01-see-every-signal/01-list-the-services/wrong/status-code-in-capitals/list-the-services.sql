-- Every service that sent spans in the last 60 minutes, busiest first, with its failed spans.
SELECT
    ServiceName AS service,
    count() AS spans,
    countIf(StatusCode = 'ERROR') AS error_spans
FROM otel_traces
WHERE Timestamp > now() - INTERVAL 60 MINUTE
GROUP BY service
ORDER BY spans DESC
