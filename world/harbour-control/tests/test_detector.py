"""The detector opens one incident per failing signal, and a fresh one only after resolution."""

from datetime import UTC, datetime, timedelta

import pytest

from harbour_control.approvals import FindingReport, InvalidTransitionError, PlannedAction
from harbour_control.detector import Detector, ErrorRateSample, StuckRequests

NOW = datetime(2026, 9, 15, 12, 0, tzinfo=UTC)
RATES = [0.01, 0.012, 0.009, 0.011, 0.01, 0.013, 0.008, 0.01, 0.011, 0.012] * 3
STEADY = [(NOW - timedelta(seconds=70 + 10 * i), rate) for i, rate in enumerate(RATES)]


class Signals:
    def __init__(self):
        self.current = 0.01
        self.stuck = 0
        self.buckets = STEADY

    def error_rates(self, service):
        return ErrorRateSample(buckets=self.buckets, current=self.current, requests=120)

    def stuck_requests(self, service):
        return StuckRequests(count=self.stuck, oldest_s=45 if self.stuck else 0)


def detector(store, signals):
    return Detector(signals=signals, store=store, clock=lambda: NOW)


def stuck_incidents(store):
    return [incident for incident in store.incidents() if incident.rule == "stuck_requests"]


def test_quiet_signals_open_nothing(store):
    detector(store, Signals()).tick()
    assert store.incidents() == []


def test_error_spike_opens_one_incident(store):
    signals = Signals()
    signals.current = 0.34
    watcher = detector(store, signals)
    watcher.tick()
    watcher.tick()
    (incident,) = store.incidents()
    assert (incident.rule, incident.service, incident.state) == (
        "error_rate",
        "booking-web",
        "open",
    )
    assert "34%" in incident.summary


def test_stuck_requests_open_an_incident(store):
    signals = Signals()
    signals.stuck = 6
    detector(store, signals).tick()
    (incident,) = store.incidents()
    assert (incident.rule, incident.service) == ("stuck_requests", "timetable-loader")


def test_a_resolved_incident_lets_a_new_one_open(store):
    signals = Signals()
    signals.current = 0.34
    watcher = detector(store, signals)
    watcher.tick()
    (first,) = store.incidents()
    store.resolve_incident(first.id, actor="ai-sre", resolved_at=NOW, note="rolled back")
    watcher.tick()
    assert len(store.incidents()) == 2


def test_an_incident_that_heals_on_its_own_closes_itself(store, remediations):
    signals = Signals()
    signals.current = 0.34
    now = [NOW]
    watcher = Detector(
        signals=signals, store=store, clock=lambda: now[0], remediations=remediations
    )
    watcher.tick()
    signals.current = 0.01
    now[0] = NOW + timedelta(minutes=1)
    watcher.tick()
    assert store.incidents()[0].state == "open"
    now[0] = NOW + timedelta(minutes=3)
    watcher.tick()
    (incident,) = store.incidents()
    assert incident.state == "resolved"
    (resolved,) = store.events(incident_id=incident.id, kind="incident_resolved")
    assert resolved.actor == "detector"


def test_self_recovery_expires_pending_proposal(store, remediations, rollback, incident):
    signals = Signals()
    signals.current = 0.01
    watcher = Detector(
        signals=signals,
        store=store,
        clock=lambda: NOW + timedelta(minutes=3),
        remediations=remediations,
    )
    watcher.tick()
    assert store.incident(incident.id).state == "resolved"
    assert remediations.status(rollback.action_id).state == "expired"
    (expired,) = store.events(action_id=rollback.action_id, kind="remediation_expired")
    assert expired.payload == {"reason": "self_recovered"}
    with pytest.raises(InvalidTransitionError):
        remediations.approve(rollback.action_id, approver="oncall")


def test_a_failed_verification_does_not_block_the_next_incident(store, remediations, known_trace):
    """A remediation that did not fix it leaves the incident open until the signal is clean."""
    signals = Signals()
    signals.stuck = 4
    now = [NOW]
    watcher = Detector(
        signals=signals, store=store, clock=lambda: now[0], remediations=remediations
    )
    watcher.tick()
    (incident,) = stuck_incidents(store)

    from tests.conftest import SECOND_TRACE

    remediations.telemetry.traces[SECOND_TRACE] = remediations.telemetry.traces[known_trace]
    report = FindingReport(
        incident_id=incident.id,
        service="timetable-loader",
        change={"kind": "none", "value": ""},
        pattern="request received with no request completed",
        quote="",
        trace_ids=[known_trace, SECOND_TRACE],
        hypothesis="Handlers in timetable-loader never return, so requests pile up.",
        ruled_out=[],
    )
    found = remediations.submit_finding(report, submitted_by="ai-sre")
    restart = remediations.propose(
        incident_id=incident.id,
        finding_id=found.finding_id,
        plan=PlannedAction(action="restart_service", target="timetable-loader", params={}),
        proposed_by="ai-sre",
    )
    remediations.approve(restart.action_id, approver="oncall@example.com")
    remediations.execute(restart.action_id, executed_by="ai-sre")
    remediations.record_verification(restart.action_id, passed=False, evidence={"stuck": 4})
    assert remediations.status(restart.action_id).verification == "failed"

    # The hang clears by other means; three minutes later the detector closes its own incident.
    signals.stuck = 0
    now[0] = NOW + timedelta(minutes=3)
    watcher.tick()
    assert store.incident(incident.id).state == "resolved"

    # And the next hang opens a fresh incident instead of being swallowed by the old one.
    signals.stuck = 2
    watcher.tick()
    assert len(stuck_incidents(store)) == 2


def test_a_cold_start_pages_on_the_slo_ceiling(store):
    signals = Signals()
    signals.buckets, signals.current = [], 0.15
    detector(store, signals).tick()
    (incident,) = store.incidents()
    assert "SLO ceiling" in incident.summary


def test_a_modest_rise_without_a_baseline_stays_quiet(store):
    signals = Signals()
    signals.buckets, signals.current = [], 0.07
    detector(store, signals).tick()
    assert store.incidents() == []
