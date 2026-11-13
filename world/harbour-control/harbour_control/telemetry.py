"""Read-only access to ClickStack telemetry.

It always reads as the sre_agent user, and always through named SQL.
"""

from datetime import UTC
from typing import Any

from harbour_control.approvals import GROUNDING_HOURS, TraceSeen
from harbour_control.queries import Query


def trace_seen(row: dict[str, Any]) -> TraceSeen:
    first_seen = row["first_seen"]
    first_seen = first_seen.replace(tzinfo=first_seen.tzinfo or UTC)
    return TraceSeen(row["trace_id"], first_seen, frozenset(row["services"]))


class ClickHouseTelemetry:
    def __init__(self, client, queries: dict[str, Query]):
        self.client = client
        self.queries = queries

    def rows(self, name: str, **params: Any) -> list[dict[str, Any]]:
        result = self.client.query(self.queries[name].sql, parameters=params)
        return [dict(zip(result.column_names, row, strict=True)) for row in result.result_rows]

    def trace_window(self, trace_ids: list[str]) -> list[TraceSeen]:
        rows = self.rows("trace_window", trace_ids=trace_ids, hours=GROUNDING_HOURS)
        return [trace_seen(row) for row in rows]

    def releases(self, service: str) -> set[str]:
        rows = self.rows("service_releases", service=service, hours=GROUNDING_HOURS)
        return {row["release"] for row in rows}

    def service_seen(self, service: str) -> bool:
        return bool(self.releases(service))

    def release_seen(self, service: str, release: str) -> bool:
        return release in self.releases(service)

    def log_seen(self, service: str, text: str) -> bool:
        return bool(self.rows("log_contains", service=service, text=text, hours=GROUNDING_HOURS))
