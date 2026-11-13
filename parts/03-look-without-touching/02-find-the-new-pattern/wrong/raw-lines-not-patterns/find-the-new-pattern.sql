-- Groups raw lines, not patterns. Every failed booking has its own reference, so each
-- line is its own group of one, and nothing stands out.
WITH
    now() - INTERVAL 1 MINUTE AS incident_start,
    incident_start - INTERVAL 1 MINUTE AS baseline_start
SELECT
    Body AS pattern,
    argMax(ResourceAttributes['service.version'], Timestamp) AS release,
    countIf(Timestamp >= incident_start) AS incident_lines,
    countIf(Timestamp < incident_start) AS baseline_lines,
    baseline_lines = 0 AND incident_lines > 0 AS is_new
FROM otel_logs
WHERE ServiceName = 'booking-web'
    AND Timestamp >= baseline_start
GROUP BY pattern
HAVING incident_lines > 0
ORDER BY is_new DESC, incident_lines DESC
LIMIT 20
