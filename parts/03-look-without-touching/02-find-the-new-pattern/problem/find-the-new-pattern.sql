-- Which booking-web log patterns are new in the last minute?
-- One SELECT over otel_logs. Columns: pattern, release, incident_lines, baseline_lines, is_new.
-- The incident window is the last minute. The baseline is the minute before it.
-- A pattern is new when it has lines in the incident window and none in the baseline.
-- New patterns first, then the most lines. At most 20 rows.
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
    count() AS incident_lines
FROM otel_logs
WHERE ServiceName = 'booking-web'
    AND Timestamp >= incident_start
GROUP BY pattern
ORDER BY incident_lines DESC
LIMIT 20
