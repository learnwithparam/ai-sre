-- Puts the last minute into its own baseline. The minute being judged moves the bound it
-- is judged against.
WITH
    -- One row per incident in the audit log: when it opened, and when it was resolved.
    -- An incident that is still open counts as open until now.
    incidents AS (
        SELECT
            minIf(ts, kind = 'incident_opened') AS opened,
            if(
                countIf(kind = 'incident_resolved') > 0,
                maxIf(ts, kind = 'incident_resolved'),
                now()
            ) AS resolved
        FROM sre.incident_events
        GROUP BY incident_id
    ),
    -- Every incident as one (opened, resolved) pair, kept in one list.
    (SELECT groupArray((opened, resolved)) FROM incidents) AS incident_windows,
    -- booking-web error rate per 10 second bucket. in_past_incident is true for a bucket from
    -- one minute before an incident opened to one minute after it was resolved.
    buckets AS (
        SELECT
            toStartOfInterval(Timestamp, INTERVAL 10 SECOND) AS bucket,
            countIf(StatusCode = 'Error') / count() AS error_rate,
            arrayExists(
                incident -> bucket BETWEEN incident.1 - INTERVAL 60 SECOND
                    AND incident.2 + INTERVAL 60 SECOND,
                incident_windows
            ) AS in_past_incident
        FROM otel_traces
        WHERE ServiceName = 'booking-web'
            AND SpanKind = 'Server'
            AND SpanName != 'GET /health'
            AND Timestamp > now() - INTERVAL 16 MINUTE
        GROUP BY bucket
    )
SELECT
    avgIf(error_rate, NOT in_past_incident) AS baseline_mean,
    stddevPopIf(error_rate, NOT in_past_incident) AS baseline_sigma,
    baseline_mean + 3 * baseline_sigma AS bound,
    avgIf(error_rate, bucket >= now() - INTERVAL 60 SECOND) AS current_error_rate,
    current_error_rate > bound AND current_error_rate - baseline_mean >= 0.05 AS anomalous
FROM buckets
