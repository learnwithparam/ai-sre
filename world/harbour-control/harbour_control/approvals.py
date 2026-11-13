"""Findings and human-in-the-loop remediation for Gullrock Ferries.

The AI SRE first submits a finding: the service, the change it blames, the log pattern, the trace
ids and a one-sentence hypothesis. The finding is grounded against telemetry or refused. A
remediation is proposed against a stored finding, a human decides, and only then does the control
plane act.

Every transition is an event in the audit log, and state is derived from those events alone.
"""

import threading
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import Any, Protocol

from harbour_control.policy import validate_action
from harbour_control.store import Event, Store, new_id, utcnow

GROUNDING_HOURS = 6  # evidence must have been reported within this window
TRACE_LEAD = timedelta(minutes=15)  # a failing request can start just before the detector notices
CHANGE_KINDS = ("release", "config", "none")

# The states an action must be in before each decision can be recorded against it.
ALLOWED_FROM = {
    "remediation_approved": {"pending"},
    "remediation_rejected": {"pending"},
    "remediation_expired": {"pending"},
    "remediation_edited": {"pending", "rejected"},
}

# The state each audit event moves an action into.
STATE_AFTER = {
    "remediation_approved": "approved",
    "remediation_rejected": "rejected",
    "remediation_expired": "expired",
}


class ApprovalRequiredError(PermissionError):
    pass


class InvalidTransitionError(ValueError):
    pass


class UngroundedError(ValueError):
    pass


@dataclass(frozen=True)
class TraceSeen:
    trace_id: str
    first_seen: datetime
    services: frozenset[str]


class Telemetry(Protocol):
    def trace_window(self, trace_ids: list[str]) -> list[TraceSeen]: ...
    def service_seen(self, service: str) -> bool: ...
    def release_seen(self, service: str, release: str) -> bool: ...
    def log_seen(self, service: str, text: str) -> bool: ...


class Runner(Protocol):
    def run(self, action: str, target: str, params: dict[str, str]) -> dict[str, Any]: ...


@dataclass(frozen=True)
class FindingReport:
    """What the AI SRE claims about an incident, before it is checked against telemetry."""

    incident_id: str
    service: str
    change: dict[str, str]
    pattern: str
    trace_ids: list[str]
    hypothesis: str
    quote: str = ""
    ruled_out: list[dict[str, str]] = field(default_factory=list)


@dataclass(frozen=True)
class PlannedAction:
    """One action from the policy, the target it acts on, and its parameters."""

    action: str
    target: str
    params: dict[str, str]


@dataclass(frozen=True)
class Finding:
    finding_id: str
    incident_id: str
    service: str
    change: dict[str, str]
    pattern: str
    quote: str
    trace_ids: list[str]
    hypothesis: str
    ruled_out: list[dict[str, str]]
    submitted_by: str
    submitted_at: datetime


@dataclass(frozen=True)
class ActionState:
    action_id: str
    incident_id: str
    finding_id: str
    state: str
    action: str
    target: str
    params: dict[str, str]
    root_cause: str
    service: str
    release: str
    trace_ids: list[str]
    proposed_by: str
    proposed_at: datetime
    result: dict[str, Any] | None = None
    verification: str | None = None
    history: list[Event] = field(default_factory=list)


def blamed_release(finding: Finding) -> str:
    """The release a finding blames, or an empty string when it blames no release."""
    if finding.change.get("kind") == "release":
        return finding.change.get("value", "")
    return ""


def apply_event(state: ActionState, event: Event) -> ActionState:
    """The action's state after one more audit event."""
    if event.kind in STATE_AFTER:
        return replace(state, state=STATE_AFTER[event.kind])
    if event.kind == "remediation_edited":
        return replace(state, state="pending", **event.payload)
    if event.kind == "remediation_executed":
        return replace(state, state="executed", result=event.payload.get("result"))
    if event.kind == "remediation_failed":
        return replace(state, state="failed", result=event.payload.get("result"))
    if event.kind in ("verification_passed", "verification_failed"):
        return replace(state, verification=event.kind.removeprefix("verification_"))
    return state


def check_finding_shape(payload: dict[str, Any]) -> None:
    """Refuse a finding that is incomplete before any telemetry is read."""
    change = payload["change"] or {}
    kind = change.get("kind", "")
    if kind not in CHANGE_KINDS:
        allowed = ", ".join(CHANGE_KINDS)
        raise UngroundedError(f"change.kind must be one of {allowed}, got {kind!r}")
    if kind != "none" and not change.get("value", ""):
        raise UngroundedError("name the release or config version in change.value")
    if len(payload["trace_ids"]) < 2:
        raise UngroundedError("cite at least two trace ids that a tool returned")
    hypothesis = payload["hypothesis"]
    if not hypothesis.strip() or hypothesis.count(". ") > 1:
        raise UngroundedError("the hypothesis is one sentence")


class Remediations:
    def __init__(
        self, *, store: Store, telemetry: Telemetry, runner: Runner, clock: Callable = utcnow
    ):
        self.store = store
        self.telemetry = telemetry
        self.runner = runner
        self.clock = clock
        # One process runs the control plane; this lock makes a double click execute once.
        self._lock = threading.Lock()

    # Findings -----------------------------------------------------------------------------------

    def submit_finding(self, report: FindingReport, *, submitted_by: str) -> Finding:
        """Store a grounded finding, or record why it was refused and raise UngroundedError."""
        payload = {
            "service": report.service,
            "change": report.change,
            "pattern": report.pattern,
            "quote": report.quote,
            "trace_ids": report.trace_ids,
            "hypothesis": report.hypothesis,
            "ruled_out": report.ruled_out,
        }
        incident_id = report.incident_id
        finding_id = new_id("fnd")
        try:
            self.store.incident(incident_id)
        except KeyError as err:
            raise UngroundedError(f"no incident {incident_id}") from err
        try:
            self._check_finding(incident_id, payload)
        except UngroundedError as err:
            refused = {**payload, "reason": str(err)}
            self.store.append(
                Event(
                    self.clock(), incident_id, finding_id, "finding_refused", submitted_by, refused
                )
            )
            raise
        self.store.append(
            Event(self.clock(), incident_id, finding_id, "finding_submitted", submitted_by, payload)
        )
        return self.finding(finding_id)

    def _check_finding(self, incident_id: str, payload: dict[str, Any]) -> None:
        check_finding_shape(payload)
        service = payload["service"]
        change = payload["change"]
        release = ""
        if change["kind"] == "release":
            release = change["value"].removeprefix(f"{service}.")
            payload["change"] = {"kind": "release", "value": release}
        self._ground(incident_id, service, release, payload["trace_ids"])
        quote = payload["quote"]
        if quote and not self.telemetry.log_seen(service, quote):
            raise UngroundedError(
                f"no log line from {service} in the last {GROUNDING_HOURS} hours contains the quote"
            )

    def _ground(self, incident_id: str, service: str, release: str, trace_ids: list[str]) -> None:
        """Evidence must exist, belong to the named service, and not predate the incident."""
        window = f"the last {GROUNDING_HOURS} hours"
        if not self.telemetry.service_seen(service):
            raise UngroundedError(f"service {service!r} has no telemetry in {window}")
        if release and not self.telemetry.release_seen(service, release):
            raise UngroundedError(f"release {release!r} of {service} has no telemetry in {window}")
        traces = self.telemetry.trace_window(trace_ids)
        seen = {trace.trace_id: trace for trace in traces}
        missing = [trace_id for trace_id in trace_ids if trace_id not in seen]
        if missing:
            raise UngroundedError(
                f"these trace ids have no spans or logs in {window}: {', '.join(missing)}"
            )
        incident = self.store.incident(incident_id)
        earliest = incident.opened_at - TRACE_LEAD
        too_old = [trace_id for trace_id in trace_ids if seen[trace_id].first_seen < earliest]
        if too_old:
            raise UngroundedError(
                "these traces began more than 15 minutes before this incident opened: "
                f"{', '.join(too_old)}"
            )
        elsewhere = [trace_id for trace_id in trace_ids if service not in seen[trace_id].services]
        if elsewhere:
            raise UngroundedError(f"these traces never touched {service}: {', '.join(elsewhere)}")

    def finding(self, finding_id: str) -> Finding:
        events = self.store.events(action_id=finding_id)
        if not events or events[0].kind != "finding_submitted":
            raise KeyError(finding_id)
        submitted = events[0]
        payload = submitted.payload
        return Finding(
            finding_id=finding_id,
            incident_id=submitted.incident_id,
            service=payload["service"],
            change=payload["change"],
            pattern=payload["pattern"],
            quote=payload.get("quote", ""),
            trace_ids=payload["trace_ids"],
            hypothesis=payload["hypothesis"],
            ruled_out=payload.get("ruled_out", []),
            submitted_by=submitted.actor,
            submitted_at=submitted.ts,
        )

    def findings_for(self, incident_id: str) -> list[Finding]:
        submitted = self.store.events(incident_id=incident_id, kind="finding_submitted")
        return [self.finding(event.action_id) for event in submitted]

    # Remediations -------------------------------------------------------------------------------

    def propose(
        self, *, incident_id: str, finding_id: str, plan: PlannedAction, proposed_by: str
    ) -> ActionState:
        self._check_proposal(incident_id, finding_id, plan, proposed_by)
        # One live proposal per incident: a retried call returns the one already waiting,
        # so a human never sees two approval requests for the same outage.
        actions = self.actions_for(incident_id)
        live = [action for action in actions if action.state in ("pending", "approved")]
        if live:
            return live[0]
        action_id = new_id("act")
        payload = {
            "finding_id": finding_id,
            "action": plan.action,
            "target": plan.target,
            "params": plan.params,
        }
        self.store.append(
            Event(
                self.clock(), incident_id, action_id, "remediation_proposed", proposed_by, payload
            )
        )
        return self.status(action_id)

    def _check_proposal(
        self, incident_id: str, finding_id: str, plan: PlannedAction, proposed_by: str
    ) -> None:
        """Refuse, and record, a proposal with no stored finding or outside the policy."""
        try:
            finding = self.finding(finding_id)
            if finding.incident_id != incident_id:
                raise KeyError(finding_id)
            validate_action(plan.action, plan.target, plan.params)
        except (KeyError, ValueError) as err:
            missing_finding = isinstance(err, KeyError)
            reason = str(err)
            if missing_finding:
                reason = f"no stored finding {finding_id} for {incident_id}"
            payload = {
                "finding_id": finding_id,
                "action": plan.action,
                "target": plan.target,
                "params": plan.params,
                "reason": reason,
            }
            self.store.append(
                Event(
                    self.clock(),
                    incident_id,
                    new_id("act"),
                    "proposal_refused",
                    proposed_by,
                    payload,
                )
            )
            if missing_finding:
                raise UngroundedError(reason) from err
            raise

    def status(self, action_id: str) -> ActionState:
        events = self.store.events(action_id=action_id)
        if not events or events[0].kind != "remediation_proposed":
            raise KeyError(action_id)
        proposed = events[0]
        payload = proposed.payload
        finding = self.finding(payload["finding_id"])
        state = ActionState(
            action_id=action_id,
            incident_id=proposed.incident_id,
            finding_id=finding.finding_id,
            state="pending",
            action=payload["action"],
            target=payload["target"],
            params=payload["params"],
            root_cause=finding.hypothesis,
            service=finding.service,
            release=blamed_release(finding),
            trace_ids=finding.trace_ids,
            proposed_by=proposed.actor,
            proposed_at=proposed.ts,
            history=events,
        )
        for event in events[1:]:
            state = apply_event(state, event)
        return state

    def actions_for(self, incident_id: str) -> list[ActionState]:
        proposed = self.store.events(incident_id=incident_id, kind="remediation_proposed")
        return [self.status(event.action_id) for event in proposed]

    def _decide(self, action_id: str, kind: str, actor: str, payload: dict) -> ActionState:
        with self._lock:
            current = self.status(action_id)
            if current.state not in ALLOWED_FROM[kind]:
                raise InvalidTransitionError(
                    f"{action_id} is {current.state}; cannot record {kind}"
                )
            self.store.append(
                Event(self.clock(), current.incident_id, action_id, kind, actor, payload)
            )
        return self.status(action_id)

    def approve(self, action_id: str, *, approver: str) -> ActionState:
        return self._decide(action_id, "remediation_approved", approver, {})

    def reject(self, action_id: str, *, approver: str, reason: str) -> ActionState:
        return self._decide(action_id, "remediation_rejected", approver, {"reason": reason})

    def expire(self, action_id: str, *, reason: str) -> ActionState:
        """The outage it answered is over, so approving it now would change a healthy system."""
        payload = {"reason": reason}
        return self._decide(action_id, "remediation_expired", "harbour-control", payload)

    def edit(self, action_id: str, *, editor: str, plan: PlannedAction) -> ActionState:
        validate_action(plan.action, plan.target, plan.params)
        # An edit can come long after the proposal; the evidence it still rests on must still exist.
        current = self.status(action_id)
        self._ground(current.incident_id, current.service, current.release, current.trace_ids)
        payload = {"action": plan.action, "target": plan.target, "params": plan.params}
        return self._decide(action_id, "remediation_edited", editor, payload)

    def execute(self, action_id: str, *, executed_by: str) -> dict[str, Any]:
        with self._lock:
            current = self.status(action_id)
            if current.state == "executed":
                return current.result or {}
            if current.state != "approved":
                refused = {"state": current.state}
                incident_id = current.incident_id
                self.store.append(
                    Event(
                        self.clock(),
                        incident_id,
                        action_id,
                        "remediation_refused",
                        executed_by,
                        refused,
                    )
                )
                raise ApprovalRequiredError(
                    f"{action_id} is {current.state}; "
                    f"a human must approve it at /actions/{action_id} first"
                )
            return self._run(current, executed_by)

    def _run(self, current: ActionState, executed_by: str) -> dict[str, Any]:
        """Run an approved action once and record what happened."""
        result = self.runner.run(current.action, current.target, current.params)
        kind = "remediation_executed" if result.get("exit_code") == 0 else "remediation_failed"
        payload = {"action": current.action, "target": current.target, "params": current.params}
        outcome = {**payload, "result": result}
        self.store.append(
            Event(self.clock(), current.incident_id, current.action_id, kind, executed_by, outcome)
        )
        return result

    def record_verification(self, action_id: str, *, passed: bool, evidence: dict) -> None:
        current = self.status(action_id)
        kind = "verification_passed" if passed else "verification_failed"
        now = self.clock()
        self.store.append(
            Event(now, current.incident_id, action_id, kind, "harbour-control", evidence)
        )
        if passed:
            self.store.resolve_incident(
                current.incident_id,
                actor="harbour-control",
                resolved_at=now,
                note="Recovery confirmed on a full minute of traffic after the approved change",
            )
