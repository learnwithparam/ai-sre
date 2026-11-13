"""The audit log. Every incident and remediation is an append-only stream of events.

State is derived from those events.

Append-only means the record of who decided what, and when, can never be edited after the fact.
"""

import json
import secrets
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any


@dataclass(frozen=True)
class Event:
    ts: datetime
    incident_id: str
    action_id: str
    kind: str
    actor: str
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Incident:
    id: str
    rule: str
    service: str
    summary: str
    opened_at: datetime
    state: str
    details: dict[str, Any]
    resolved_at: datetime | None = None


@dataclass(frozen=True)
class IncidentReport:
    """What a detector or a person reports when they open an incident."""

    rule: str
    service: str
    summary: str
    details: dict[str, Any] = field(default_factory=dict)


def new_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(6)}"


def event_time(event: Event) -> datetime:
    return event.ts


def first_of_kind(events: list[Event], kind: str) -> Event | None:
    return next((event for event in events if event.kind == kind), None)


class Store:
    """Derivations shared by every backend. Subclasses implement append() and events()."""

    def append(self, event: Event) -> None:
        raise NotImplementedError

    def events(
        self,
        *,
        incident_id: str | None = None,
        action_id: str | None = None,
        kind: str | None = None,
    ) -> list[Event]:
        raise NotImplementedError

    def open_incident(self, report: IncidentReport, *, opened_at: datetime) -> Incident:
        incident_id = new_id("inc")
        payload = {
            "rule": report.rule,
            "service": report.service,
            "summary": report.summary,
            "details": report.details or {},
        }
        self.append(Event(opened_at, incident_id, "", "incident_opened", "detector", payload))
        return self.incident(incident_id)

    def resolve_incident(
        self, incident_id: str, *, actor: str, resolved_at: datetime, note: str
    ) -> None:
        payload = {"note": note}
        self.append(Event(resolved_at, incident_id, "", "incident_resolved", actor, payload))

    def incident(self, incident_id: str) -> Incident:
        events = self.events(incident_id=incident_id)
        opened = first_of_kind(events, "incident_opened")
        if opened is None:
            raise KeyError(incident_id)
        resolved = first_of_kind(events, "incident_resolved")
        payload = opened.payload
        return Incident(
            id=incident_id,
            rule=payload["rule"],
            service=payload["service"],
            summary=payload["summary"],
            opened_at=opened.ts,
            state="resolved" if resolved else "open",
            details=payload.get("details", {}),
            resolved_at=resolved.ts if resolved else None,
        )

    def incidents(self) -> list[Incident]:
        opened = self.events(kind="incident_opened")
        newest_first = sorted(opened, key=event_time, reverse=True)
        return [self.incident(event.incident_id) for event in newest_first]

    def incident_windows(
        self, rule: str, service: str, *, now: datetime, margin: timedelta
    ) -> list[tuple[datetime, datetime]]:
        return [
            (incident.opened_at - margin, (incident.resolved_at or now) + margin)
            for incident in self.incidents()
            if (incident.rule, incident.service) == (rule, service)
        ]

    def open_incident_for(self, rule: str, service: str) -> Incident | None:
        for incident in self.incidents():
            if (incident.rule, incident.service, incident.state) == (rule, service, "open"):
                return incident
        return None


class MemoryStore(Store):
    def __init__(self) -> None:
        self._events: list[Event] = []

    def append(self, event: Event) -> None:
        self._events.append(event)

    def events(self, *, incident_id=None, action_id=None, kind=None) -> list[Event]:
        return sorted(
            (
                event
                for event in self._events
                if (incident_id is None or event.incident_id == incident_id)
                and (action_id is None or event.action_id == action_id)
                and (kind is None or event.kind == kind)
            ),
            key=event_time,
        )


SCHEMA = """
CREATE TABLE IF NOT EXISTS sre.incident_events
(
    ts DateTime64(3, 'UTC'),
    incident_id String,
    action_id String,
    kind LowCardinality(String),
    actor String,
    payload String
)
ENGINE = MergeTree
ORDER BY (incident_id, ts)
"""


class ClickHouseStore(Store):
    """Writes as harbour_control, the only user allowed to insert into the sre database."""

    def __init__(self, client) -> None:
        self.client = client

    def migrate(self, statements: list[str]) -> None:
        self.client.command("CREATE DATABASE IF NOT EXISTS sre")
        for sql in [SCHEMA, *statements]:
            self.client.command(sql)

    def append(self, event: Event) -> None:
        self.client.insert(
            "sre.incident_events",
            [
                [
                    event.ts,
                    event.incident_id,
                    event.action_id,
                    event.kind,
                    event.actor,
                    json.dumps(event.payload),
                ]
            ],
            column_names=["ts", "incident_id", "action_id", "kind", "actor", "payload"],
        )

    def events(self, *, incident_id=None, action_id=None, kind=None) -> list[Event]:
        # An empty parameter means "any", so the SQL text is fixed and every value is bound.
        params = {
            "incident_id": incident_id or "",
            "action_id": action_id or "",
            "kind": kind or "",
        }
        rows = self.client.query(
            """SELECT ts, incident_id, action_id, kind, actor, payload FROM sre.incident_events
               WHERE ({incident_id:String} = '' OR incident_id = {incident_id:String})
                 AND ({action_id:String} = '' OR action_id = {action_id:String})
                 AND ({kind:String} = '' OR kind = {kind:String})
               ORDER BY ts LIMIT 10000""",
            parameters=params,
        ).result_rows
        return [event_from_row(row) for row in rows]


def event_from_row(row: tuple) -> Event:
    """Columns arrive in the order the SELECT names them; ClickHouse drops the time zone."""
    time, incident_id, action_id, kind, actor, payload = row
    return Event(time.replace(tzinfo=UTC), incident_id, action_id, kind, actor, json.loads(payload))


def utcnow() -> datetime:
    return datetime.now(UTC)
