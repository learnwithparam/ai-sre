-- Which release fails the bookings? One SELECT over otel_traces.
-- Columns: release, requests, errors, error_rate. One row per release.
-- Count only POST /api/bookings requests of booking-web, in the last 15 minutes.
-- The release is in ResourceAttributes['service.version']. Highest error_rate first.
SELECT
    count() AS requests,
    countIf(StatusCode = 'Error') AS errors
FROM otel_traces
WHERE ServiceName = 'booking-web'
    AND Timestamp > now() - INTERVAL 15 MINUTE
