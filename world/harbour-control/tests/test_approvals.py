"""Human-in-the-loop rules: the agent proposes, only a human decision lets anything run."""

import pytest

from harbour_control.approvals import ApprovalRequiredError, InvalidTransitionError, PlannedAction


def test_execute_without_approval_refuses(remediations, rollback, runner):
    with pytest.raises(ApprovalRequiredError):
        remediations.execute(rollback.action_id, executed_by="ai-sre")
    assert runner.calls == []
    assert remediations.status(rollback.action_id).state == "pending"


def test_execute_twice_runs_once(remediations, rollback, runner):
    remediations.approve(rollback.action_id, approver="oncall@example.com")
    first = remediations.execute(rollback.action_id, executed_by="ai-sre")
    second = remediations.execute(rollback.action_id, executed_by="ai-sre")
    assert runner.calls == [("rollback_release", "booking-web", {"release": "v1"})]
    assert first == second
    assert remediations.status(rollback.action_id).state == "executed"


def test_reject_never_executes(remediations, rollback, runner):
    remediations.reject(rollback.action_id, approver="oncall@example.com", reason="wrong target")
    with pytest.raises(ApprovalRequiredError):
        remediations.execute(rollback.action_id, executed_by="ai-sre")
    assert runner.calls == []
    assert remediations.status(rollback.action_id).state == "rejected"


def test_edit_resets_to_pending_and_still_needs_approval(remediations, rollback, runner):
    remediations.reject(rollback.action_id, approver="oncall@example.com", reason="restart instead")
    remediations.edit(
        rollback.action_id,
        editor="oncall@example.com",
        plan=PlannedAction(action="restart_service", target="booking-web", params={}),
    )
    state = remediations.status(rollback.action_id)
    assert (state.state, state.action, state.target) == (
        "pending",
        "restart_service",
        "booking-web",
    )
    with pytest.raises(ApprovalRequiredError):
        remediations.execute(rollback.action_id, executed_by="ai-sre")
    remediations.approve(rollback.action_id, approver="oncall@example.com")
    remediations.execute(rollback.action_id, executed_by="ai-sre")
    assert runner.calls == [("restart_service", "booking-web", {})]


def test_decisions_only_apply_to_pending_actions(remediations, rollback):
    remediations.approve(rollback.action_id, approver="oncall@example.com")
    remediations.execute(rollback.action_id, executed_by="ai-sre")
    with pytest.raises(InvalidTransitionError):
        remediations.reject(rollback.action_id, approver="oncall@example.com", reason="late")
    with pytest.raises(InvalidTransitionError):
        remediations.approve(rollback.action_id, approver="oncall@example.com")


def test_audit_records_every_step_with_actor_and_time(remediations, rollback, store):
    remediations.approve(rollback.action_id, approver="oncall@example.com")
    remediations.execute(rollback.action_id, executed_by="ai-sre")
    events = store.events(action_id=rollback.action_id)
    kinds = [event.kind for event in events]
    assert kinds == ["remediation_proposed", "remediation_approved", "remediation_executed"]
    assert [event.actor for event in events] == ["ai-sre", "oncall@example.com", "ai-sre"]
    assert all(event.ts is not None for event in events)
    assert events == sorted(events, key=lambda event: event.ts)


def test_proposing_twice_returns_the_waiting_proposal(remediations, rollback):
    again = remediations.propose(
        incident_id=rollback.incident_id,
        finding_id=rollback.finding_id,
        plan=PlannedAction(action="restart_service", target="booking-web", params={}),
        proposed_by="ai-sre",
    )
    assert again.action_id == rollback.action_id
    proposed = remediations.store.events(
        incident_id=rollback.incident_id, kind="remediation_proposed"
    )
    assert len(proposed) == 1
