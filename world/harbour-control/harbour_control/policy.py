"""What the AI SRE may do at Gullrock Ferries.

Reads are free; one tool acts, and only after a human approves.
"""

import re
from enum import StrEnum


class ToolClass(StrEnum):
    READ = "read"
    RECORD = "record"  # writes to the audit log only; changes nothing in the world
    ACTION = "action"


TOOL_CLASSES: dict[str, ToolClass] = {
    "list_sources": ToolClass.READ,
    "service_timeseries": ToolClass.READ,
    "analyze_service_anomalies": ToolClass.READ,
    "get_event_deltas": ToolClass.READ,
    "event_patterns": ToolClass.READ,
    "get_trace_waterfall": ToolClass.READ,
    "search_logs": ToolClass.READ,
    "slo_burn": ToolClass.READ,
    "list_incidents": ToolClass.READ,
    "get_incident": ToolClass.READ,
    "get_remediation_status": ToolClass.READ,
    "submit_finding": ToolClass.RECORD,
    "propose_remediation": ToolClass.RECORD,
    "execute_remediation": ToolClass.ACTION,
}

# action -> target -> allowed values for each parameter. Nothing outside this map can run.
ACTIONS: dict[str, dict[str, dict[str, set[str]]]] = {
    "rollback_release": {"booking-web": {"release": {"v1"}}},
    "restart_service": {"timetable-loader": {}, "booking-web": {}},
    "rollback_config": {"fares": {"version": {"previous"}}},
}

# A remediation targets a container or a config file; telemetry names a service.
# The agent needs both.
TARGETS: dict[str, str] = {
    "booking-web": (
        "container running service booking-web (Bun), which calls timetable-loader and Postgres"
    ),
    "timetable-loader": (
        "container running service timetable-loader (Go), called by booking-web GET /timetable"
    ),
    "fares": (
        "the fare table file booking-web rereads when it changes; "
        "history keeps every pushed version"
    ),
}

# Shown on the approval page, so the approver sees the cost of saying yes.
BLAST_RADIUS = {
    "rollback_release": (
        "Redeploys booking-web on the previous image. The booking page returns errors for the "
        "few seconds the container takes to pass its health check, so passengers mid-booking "
        "must try again. Anything shipped in the newer release is withdrawn until it is fixed "
        "and deployed again."
    ),
    "restart_service": (
        "Restarts one container. Requests in flight to it fail, and callers see errors until its "
        "health check passes. Nothing about the code changes, so a defect that caused the "
        "incident can recur."
    ),
    "rollback_config": (
        "Puts back the fare table that was live before the last push. Every route is priced "
        "from it at once. Fare changes in the pushed file are lost until someone fixes the file "
        "and pushes it again."
    ),
}

SAFE = re.compile(r"^[a-z0-9][a-z0-9.-]*$")


class PolicyError(ValueError):
    pass


def validate_action(action: str, target: str, params: dict[str, str]) -> None:
    targets = ACTIONS.get(action)
    if targets is None:
        raise PolicyError(f"action {action!r} is not allowed; allowed: {sorted(ACTIONS)}")
    allowed = targets.get(target)
    if allowed is None:
        raise PolicyError(f"{action} cannot target {target!r}; allowed: {sorted(targets)}")
    if set(params) != set(allowed):
        raise PolicyError(f"{action} takes exactly {sorted(allowed)}, got {sorted(params)}")
    for key, value in params.items():
        if not SAFE.match(str(value)) or value not in allowed[key]:
            raise PolicyError(
                f"{action} {key}={value!r} is not allowed; allowed: {sorted(allowed[key])}"
            )
