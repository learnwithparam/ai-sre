from datetime import UTC, datetime, timedelta

import pytest

# harbour_control is imported inside fixtures, so a broken module fails its own tests and
# never aborts collection for the whole gate (which would zero every phase of the score).

NOW = datetime(2026, 9, 15, 12, 0, tzinfo=UTC)
KNOWN_TRACE = "4bf92f3577b34da6a3ce929d0e0e4736"


class FakeTelemetry:
    """Telemetry that knows one service, one release and one failing trace."""

    services = {"booking-web": {"v1", "v2"}, "timetable-loader": {"1.0.0"}}

    def __init__(self):
        # trace id -> (first span time, services it touched)
        self.traces = {KNOWN_TRACE: (NOW, frozenset({"booking-web", "timetable-loader"}))}

    def trace_window(self, trace_ids):
        from harbour_control.approvals import TraceSeen

        return [TraceSeen(t, *self.traces[t]) for t in trace_ids if t in self.traces]

    def service_seen(self, service):
        return service in self.services

    def release_seen(self, service, release):
        return release in self.services.get(service, set())

    def log_seen(self, service, text):
        return (
            text
            == "connection pool exhausted: 2 of 2 connections in use (audit_trail) ref=GR-TEST1"
        )


class FakeRunner:
    def __init__(self):
        self.calls = []

    def run(self, action, target, params):
        self.calls.append((action, target, dict(params)))
        return {"exit_code": 0, "output": f"{action} {target} ok"}


class Clock:
    def __init__(self):
        self.now = NOW

    def __call__(self):
        self.now += timedelta(seconds=1)
        return self.now


@pytest.fixture
def known_trace():
    return KNOWN_TRACE


@pytest.fixture
def store():
    from harbour_control.store import MemoryStore

    return MemoryStore()


@pytest.fixture
def runner():
    return FakeRunner()


@pytest.fixture
def remediations(store, runner):
    from harbour_control.approvals import Remediations

    return Remediations(store=store, telemetry=FakeTelemetry(), runner=runner, clock=Clock())


@pytest.fixture
def incident(store):
    return store.open_incident(
        rule="error_rate",
        service="booking-web",
        summary="error rate 34% against a 3 sigma bound of 2%",
        opened_at=NOW,
    )


SECOND_TRACE = "5cf92f3577b34da6a3ce929d0e0e4737"


@pytest.fixture
def finding(remediations, incident):
    remediations.telemetry.traces[SECOND_TRACE] = remediations.telemetry.traces[KNOWN_TRACE]
    return remediations.submit_finding(
        incident_id=incident.id,
        service="booking-web",
        change={"kind": "release", "value": "v2"},
        pattern="connection pool exhausted (audit_trail)",
        quote="connection pool exhausted: 2 of 2 connections in use (audit_trail) ref=GR-TEST1",
        trace_ids=[KNOWN_TRACE, SECOND_TRACE],
        hypothesis="Release v2 of booking-web opens a connection per booking for its audit trail and runs out.",
        ruled_out=[],
        submitted_by="ai-sre",
    )


@pytest.fixture
def rollback(remediations, incident, finding):
    return remediations.propose(
        incident_id=incident.id,
        finding_id=finding.finding_id,
        action="rollback_release",
        target="booking-web",
        params={"release": "v1"},
        proposed_by="ai-sre",
    )
