-- booking-web log patterns of the last minute, compared with the minute before.
-- New patterns first, then the most lines.
WITH
    -- A pattern is a log line with its changing parts masked: booking references become <ref>,
    -- addresses become <ip>, and every other number becomes N. Then lines of one kind match.
    replaceRegexpAll(
        replaceRegexpAll(
            replaceRegexpAll(Body, '[A-Z]{2}-[A-Z0-9]{6}', '<ref>'),
            '\\d+\\.\\d+\\.\\d+\\.\\d+',
            '<ip>'
        ),
        '\\d+',
        'N'
    ) AS pattern,
    now() - INTERVAL 1 MINUTE AS incident_start,
    incident_start - INTERVAL 1 MINUTE AS baseline_start
SELECT
    pattern,
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
