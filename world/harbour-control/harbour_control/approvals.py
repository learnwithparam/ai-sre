"""Findings and human-in-the-loop remediation for Gullrock Ferries.

The AI SRE first submits a finding: the service, the change it blames, the log pattern, the trace ids
and a one-sentence hypothesis. The finding is grounded against telemetry or refused. A remediation is
proposed against a stored finding, a human decides, and only then does the control plane act.

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


class ApprovalRequired(PermissionError):
    pass


class InvalidTransition(ValueError):
    pass


class Ungrounded(ValueError):
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


class Remediations:
    def __init__(self, *, store: Store, telemetry: Telemetry, runner: Runner, clock: Callable = utcnow):
        self.store, self.telemetry, self.runner, self.clock = store, telemetry, runner, clock
        # One process runs the control plane; this lock makes a double click execute once.
        self._lock = threading.Lock()

    # Findings -----------------------------------------------------------------------------------

    def submit_finding(
        self,
        *,
        incident_id: str,
        service: str,
        change: dict[str, str],
        pattern: str,
        quote: str,
        trace_ids: list[str],
        hypothesis: str,
        ruled_out: list[dict[str, str]],
        submitted_by: str,
    ) -> Finding:
        """Store a grounded finding, or record why it was refused and raise Ungrounded."""
        payload = {
            "service": service,
            "change": change,
            "pattern": pattern,
            "quote": quote,
            "trace_ids": trace_ids,
            "hypothesis": hypothesis,
            "ruled_out": ruled_out,
        }
        finding_id = new_id("fnd")
        try:
            self.store.incident(incident_id)
        except KeyError as err:
            raise Ungrounded(f"no incident {incident_id}") from err
        try:
            self._check_finding(incident_id, payload)
        except Ungrounded as err:
            refused = {**payload, "reason": str(err)}
            self.store.append(Event(self.clock(), incident_id, finding_id, "finding_refused", submitted_by, refused))
            raise
        self.store.append(Event(self.clock(), incident_id, finding_id, "finding_submitted", submitted_by, payload))
        return self.finding(finding_id)

    def _check_finding(self, incident_id: str, p: dict[str, Any]) -> None:
        kind = (p["change"] or {}).get("kind", "")
        value = (p["change"] or {}).get("value", "")
        if kind not in CHANGE_KINDS:
            raise Ungrounded(f"change.kind must be one of {', '.join(CHANGE_KINDS)}, got {kind!r}")
        if kind != "none" and not value:
            raise Ungrounded("name the release or config version in change.value")
        if len(p["trace_ids"]) < 2:
            raise Ungrounded("cite at least two trace ids that a tool returned")
        if not p["hypothesis"].strip() or p["hypothesis"].count(". ") > 1:
            raise Ungrounded("the hypothesis is one sentence")
        service = p["service"]
        if kind == "release":
            p["change"] = {"kind": kind, "value": value.removeprefix(f"{service}.")}
        self._ground(incident_id, service, p["change"]["value"] if kind == "release" else "", p["trace_ids"])
        if p["quote"] and not self.telemetry.log_seen(service, p["quote"]):
            raise Ungrounded(f"no log line from {service} in the last {GROUNDING_HOURS} hours contains the quote")

    def _ground(self, incident_id: str, service: str, release: str, trace_ids: list[str]) -> None:
        """Evidence must exist, belong to the named service, and not predate the incident."""
        window = f"the last {GROUNDING_HOURS} hours"
        if not self.telemetry.service_seen(service):
            raise Ungrounded(f"service {service!r} has no telemetry in {window}")
        if release and not self.telemetry.release_seen(service, release):
            raise Ungrounded(f"release {release!r} of {service} has no telemetry in {window}")
        seen = {t.trace_id: t for t in self.telemetry.trace_window(trace_ids)}
        missing = [t for t in trace_ids if t not in seen]
        if missing:
            raise Ungrounded(f"these trace ids have no spans or logs in {window}: {', '.join(missing)}")
        incident = self.store.incident(incident_id)
        too_old = [t for t in trace_ids if seen[t].first_seen < incident.opened_at - TRACE_LEAD]
        if too_old:
            raise Ungrounded(
                f"these traces began more than 15 minutes before this incident opened: {', '.join(too_old)}"
            )
        elsewhere = [t for t in trace_ids if service not in seen[t].services]
        if elsewhere:
            raise Ungrounded(f"these traces never touched {service}: {', '.join(elsewhere)}")

    def finding(self, finding_id: str) -> Finding:
        events = self.store.events(action_id=finding_id)
        if not events or events[0].kind != "finding_submitted":
            raise KeyError(finding_id)
        e = events[0]
        p = e.payload
        return Finding(
            finding_id=finding_id,
            incident_id=e.incident_id,
            service=p["service"],
            change=p["change"],
            pattern=p["pattern"],
            quote=p.get("quote", ""),
            trace_ids=p["trace_ids"],
            hypothesis=p["hypothesis"],
            ruled_out=p.get("ruled_out", []),
            submitted_by=e.actor,
            submitted_at=e.ts,
        )

    def findings_for(self, incident_id: str) -> list[Finding]:
        return [self.finding(e.action_id) for e in self.store.events(incident_id=incident_id, kind="finding_submitted")]

    # Remediations -------------------------------------------------------------------------------

    def propose(
        self, *, incident_id: str, finding_id: str, action: str, target: str, params: dict[str, str], proposed_by: str
    ) -> ActionState:
        try:
            finding = self.finding(finding_id)
            if finding.incident_id != incident_id:
                raise KeyError(finding_id)
            validate_action(action, target, params)
        except (KeyError, ValueError) as err:
            reason = f"no stored finding {finding_id} for {incident_id}" if isinstance(err, KeyError) else str(err)
            payload = {"finding_id": finding_id, "action": action, "target": target, "params": params, "reason": reason}
            self.store.append(Event(self.clock(), incident_id, new_id("act"), "proposal_refused", proposed_by, payload))
            if isinstance(err, KeyError):
                raise Ungrounded(reason) from err
            raise
        # One live proposal per incident: a retried call returns the one already waiting,
        # so a human never sees two approval requests for the same outage.
        live = [a for a in self.actions_for(incident_id) if a.state in ("pending", "approved")]
        if live:
            return live[0]
        action_id = new_id("act")
        payload = {"finding_id": finding_id, "action": action, "target": target, "params": params}
        self.store.append(Event(self.clock(), incident_id, action_id, "remediation_proposed", proposed_by, payload))
        return self.status(action_id)

    def status(self, action_id: str) -> ActionState:
        events = self.store.events(action_id=action_id)
        if not events or events[0].kind != "remediation_proposed":
            raise KeyError(action_id)
        first = events[0]
        p = first.payload
        f = self.finding(p["finding_id"])
        state = ActionState(
            action_id=action_id,
            incident_id=first.incident_id,
            finding_id=f.finding_id,
            state="pending",
            action=p["action"],
            target=p["target"],
            params=p["params"],
            root_cause=f.hypothesis,
            service=f.service,
            release=f.change.get("value", "") if f.change.get("kind") == "release" else "",
            trace_ids=f.trace_ids,
            proposed_by=first.actor,
            proposed_at=first.ts,
            history=events,
        )
        for e in events[1:]:
            match e.kind:
                case "remediation_approved":
                    state = replace(state, state="approved")
                case "remediation_rejected":
                    state = replace(state, state="rejected")
                case "remediation_expired":
                    state = replace(state, state="expired")
                case "remediation_edited":
                    state = replace(state, state="pending", **e.payload)
                case "remediation_executed":
                    state = replace(state, state="executed", result=e.payload.get("result"))
                case "remediation_failed":
                    state = replace(state, state="failed", result=e.payload.get("result"))
                case "verification_passed" | "verification_failed":
                    state = replace(state, verification=e.kind.removeprefix("verification_"))
        return state

    def actions_for(self, incident_id: str) -> list[ActionState]:
        proposed = self.store.events(incident_id=incident_id, kind="remediation_proposed")
        return [self.status(e.action_id) for e in proposed]

    def _decide(self, action_id: str, kind: str, actor: str, payload: dict, allowed_from: set[str]):
        with self._lock:
            current = self.status(action_id)
            if current.state not in allowed_from:
                raise InvalidTransition(f"{action_id} is {current.state}; cannot record {kind}")
            self.store.append(Event(self.clock(), current.incident_id, action_id, kind, actor, payload))
        return self.status(action_id)

    def approve(self, action_id: str, *, approver: str) -> ActionState:
        return self._decide(action_id, "remediation_approved", approver, {}, {"pending"})

    def reject(self, action_id: str, *, approver: str, reason: str) -> ActionState:
        return self._decide(action_id, "remediation_rejected", approver, {"reason": reason}, {"pending"})

    def expire(self, action_id: str, *, reason: str) -> ActionState:
        """The outage it answered is over, so approving it now would change a healthy system."""
        return self._decide(action_id, "remediation_expired", "harbour-control", {"reason": reason}, {"pending"})

    def edit(self, action_id: str, *, editor: str, action: str, target: str, params: dict) -> ActionState:
        validate_action(action, target, params)
        # An edit can come long after the proposal; the evidence it still rests on must still exist.
        current = self.status(action_id)
        self._ground(current.incident_id, current.service, current.release, current.trace_ids)
        payload = {"action": action, "target": target, "params": params}
        return self._decide(action_id, "remediation_edited", editor, payload, {"pending", "rejected"})

    def execute(self, action_id: str, *, executed_by: str) -> dict[str, Any]:
        with self._lock:
            current = self.status(action_id)
            if current.state == "executed":
                return current.result or {}
            if current.state != "approved":
                self.store.append(
                    Event(self.clock(), current.incident_id, action_id, "remediation_refused", executed_by,
                          {"state": current.state})
                )  # fmt: skip
                raise ApprovalRequired(
                    f"{action_id} is {current.state}; a human must approve it at /actions/{action_id} first"
                )
            result = self.runner.run(current.action, current.target, current.params)
            kind = "remediation_executed" if result.get("exit_code") == 0 else "remediation_failed"
            payload = {"action": current.action, "target": current.target, "params": current.params}
            self.store.append(
                Event(self.clock(), current.incident_id, action_id, kind, executed_by, {**payload, "result": result})
            )
            return result

    def record_verification(self, action_id: str, *, passed: bool, evidence: dict) -> None:
        current = self.status(action_id)
        kind = "verification_passed" if passed else "verification_failed"
        now = self.clock()
        self.store.append(Event(now, current.incident_id, action_id, kind, "harbour-control", evidence))
        if passed:
            self.store.resolve_incident(
                current.incident_id,
                actor="harbour-control",
                at=now,
                note="Recovery confirmed on a full minute of traffic after the approved change",
            )
