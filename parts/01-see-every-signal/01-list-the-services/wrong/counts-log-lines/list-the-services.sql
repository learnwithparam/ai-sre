-- Counts log lines instead of spans: a busy logger is not a busy service.
SELECT
    ServiceName AS service,
    count() AS spans,
    countIf(SeverityText = 'error') AS error_spans
FROM otel_logs
WHERE Timestamp > now() - INTERVAL 60 MINUTE
GROUP BY service
ORDER BY spans DESC
