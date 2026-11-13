-- The old alert at Gullrock: page when booking-web wrote 3 or more warning or error lines
-- in the last minute. Do not change this file. You count its pages.
SELECT countIf(SeverityText IN ('warn', 'error')) >= 3 AS page
FROM otel_logs
WHERE ServiceName = 'booking-web'
    AND Timestamp > now() - INTERVAL 1 MINUTE
