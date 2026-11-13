"""Harbour Control with in-memory stand-ins, so the text audit can open its pages without the world.

Run from world/harbour-control: uv run python ../../e2e/harbour-fixture.py
It serves an empty incident, an incident with a finding, and a rollback proposal, on port 8090.
"""

import itertools
import secrets
import sys
from datetime import UTC, datetime
from pathlib import Path

import uvicorn

# Fixed ids, so the audit can name the pages: the first ids made are inc-000000000001 and so on.
_counter = itertools.count(1)
secrets.token_hex = lambda nbytes=6: f"{next(_counter):012x}"

sys.path.insert(
    0, str(Path(__file__).resolve().parents[1] / "world/harbour-control/tests")
)
from conftest import KNOWN_TRACE, SECOND_TRACE, Clock, FakeRunner, FakeTelemetry
from harbour_control.approvals import (
    FindingReport,
    PlannedAction,
    Remediations,
)
from harbour_control.config import load_settings
from harbour_control.store import IncidentReport, MemoryStore
from harbour_control.web import create_app

settings = load_settings(
    {
        "CLICKHOUSE_HOST": "none",
        "CLICKHOUSE_READER_USER": "r",
        "CLICKHOUSE_READER_PASSWORD": "r",
        "CLICKHOUSE_WRITER_USER": "w",
        "CLICKHOUSE_WRITER_PASSWORD": "w",
        "SRE_MCP_TOKEN": "audit",
        "SRE_APPROVER_EMAIL": "oncall@example.com",
        "SRE_APPROVER_PASSWORD": "correct horse",
        "SRE_SESSION_SECRET": "audit-secret",
        "SRE_PUBLIC_URL": "http://localhost:8090",
        "WORLD_DIR": "/tmp",
    }
)
store = MemoryStore()
telemetry = FakeTelemetry()
telemetry.traces[SECOND_TRACE] = telemetry.traces[KNOWN_TRACE]
remediations = Remediations(
    store=store, telemetry=telemetry, runner=FakeRunner(), clock=Clock()
)
now = datetime(2026, 9, 15, 12, 0, tzinfo=UTC)
report = IncidentReport(
    rule="error_rate",
    service="booking-web",
    summary="error rate 34% against a 3 sigma bound of 2%",
)
bare = store.open_incident(report, opened_at=now)
busy = store.open_incident(report, opened_at=now)
finding = remediations.submit_finding(
    FindingReport(
        incident_id=busy.id,
        service="booking-web",
        change={"kind": "release", "value": "v2"},
        pattern="connection pool exhausted (audit_trail)",
        quote="connection pool exhausted: 2 of 2 connections in use (audit_trail) ref=GR-TEST1",
        trace_ids=[KNOWN_TRACE, SECOND_TRACE],
        hypothesis="Release v2 of booking-web opens a connection per booking and runs out.",
        ruled_out=[],
    ),
    submitted_by="ai-sre",
)
action = remediations.propose(
    incident_id=busy.id,
    finding_id=finding.finding_id,
    plan=PlannedAction(
        action="rollback_release", target="booking-web", params={"release": "v1"}
    ),
    proposed_by="ai-sre",
)
app = create_app(settings=settings, remediations=remediations)
uvicorn.run(app, port=8090, log_level="warning")
