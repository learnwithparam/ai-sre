"""A finding is stored only when its evidence exists in telemetry.

A proposal is stored only against a stored finding.
"""

from datetime import timedelta

import pytest

from harbour_control.approvals import FindingReport, PlannedAction, UngroundedError
from harbour_control.policy import PolicyError
from tests.conftest import NOW, SECOND_TRACE


@pytest.fixture
def submit(remediations, incident, known_trace):
    remediations.telemetry.traces[SECOND_TRACE] = remediations.telemetry.traces[known_trace]
    base = dict(
        incident_id=incident.id,
        service="booking-web",
        change={"kind": "release", "value": "v2"},
        pattern="connection pool exhausted (audit_trail)",
        quote="",
        trace_ids=[known_trace, SECOND_TRACE],
        hypothesis="Release v2 of booking-web runs out of audit trail connections.",
        ruled_out=[],
    )

    def submit_with(**overrides):
        report = FindingReport(**{**base, **overrides})
        return remediations.submit_finding(report, submitted_by="ai-sre")

    return submit_with


def test_a_made_up_trace_id_is_refused_and_recorded(submit, incident, store, known_trace):
    with pytest.raises(UngroundedError, match="f{32}"):
        submit(trace_ids=[known_trace, "f" * 32])
    refused = store.events(incident_id=incident.id, kind="finding_refused")
    assert len(refused) == 1 and "f" * 32 in refused[0].payload["reason"]
    assert store.events(incident_id=incident.id, kind="finding_submitted") == []


def test_one_trace_is_not_enough(submit, known_trace):
    with pytest.raises(UngroundedError, match="two trace ids"):
        submit(trace_ids=[known_trace])


def test_an_old_trace_is_refused(submit, remediations, known_trace):
    remediations.telemetry.traces[known_trace] = (
        NOW - timedelta(hours=3),
        frozenset({"booking-web"}),
    )
    with pytest.raises(UngroundedError, match="before this incident opened"):
        submit()


def test_unknown_service_is_refused(submit):
    with pytest.raises(UngroundedError, match="no telemetry"):
        submit(service="payments")


def test_release_never_seen_is_refused(submit):
    with pytest.raises(UngroundedError, match="release 'v9'"):
        submit(change={"kind": "release", "value": "v9"})


def test_a_release_named_with_its_service_is_grounded(submit):
    assert submit(change={"kind": "release", "value": "booking-web.v2"}).change["value"] == "v2"


def test_a_quote_must_be_a_real_log_line(submit):
    with pytest.raises(UngroundedError, match="contains the quote"):
        submit(quote="connection pool exhausted: invented")


def test_no_change_is_a_valid_finding(submit):
    assert submit(change={"kind": "none", "value": ""}).change["kind"] == "none"


def test_a_proposal_needs_a_stored_finding(remediations, incident, store):
    with pytest.raises(UngroundedError, match="no stored finding"):
        remediations.propose(
            incident_id=incident.id,
            finding_id="fnd-nope",
            plan=PlannedAction("rollback_release", "booking-web", {"release": "v1"}),
            proposed_by="ai-sre",
        )
    assert len(store.events(incident_id=incident.id, kind="proposal_refused")) == 1


def test_action_outside_policy_is_refused(remediations, incident, finding):
    with pytest.raises(PolicyError):
        remediations.propose(
            incident_id=incident.id,
            finding_id=finding.finding_id,
            plan=PlannedAction("restart_service", "postgres", {}),
            proposed_by="ai-sre",
        )


def test_grounded_proposal_is_pending(rollback):
    assert rollback.state == "pending" and rollback.release == "v2"
