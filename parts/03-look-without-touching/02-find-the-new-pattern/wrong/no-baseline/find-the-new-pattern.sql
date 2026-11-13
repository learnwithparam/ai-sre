-- Looks at the incident window only. With no baseline, every pattern looks new, and the
-- busiest normal line (the access log) comes out on top.
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
    count() AS incident_lines,
    0 AS baseline_lines,
    1 AS is_new
FROM otel_logs
WHERE ServiceName = 'booking-web'
    AND Timestamp >= incident_start
GROUP BY pattern
ORDER BY is_new DESC, incident_lines DESC
LIMIT 20
