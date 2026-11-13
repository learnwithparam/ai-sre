-- Which services report to ClickStack, how busy is each, and how many of its spans failed?
-- One SELECT over otel_traces. Columns: service, spans, error_spans.
-- Busiest first. Last 60 minutes.
SELECT ServiceName
FROM otel_traces
LIMIT 10
