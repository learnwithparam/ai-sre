"""The harbour-control MCP server: semantic tools over workshop SQL, plus the remediation tools.

Every tool must be classified in policy.TOOL_CLASSES before it can register, and its MCP
annotations are derived from that class, so a client sees the same boundary the server enforces.
Payloads are pruned: rows are capped and rounded, because every token returned is paid for twice.
"""

import datetime as dt
import decimal
from collections.abc import Callable
from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.auth.providers.jwt import StaticTokenVerifier
from fastmcp.tools.function_tool import FunctionTool
from fastmcp.utilities.json_schema import compress_schema
from mcp.types import ToolAnnotations
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from harbour_control.approvals import (
    ApprovalRequiredError,
    FindingReport,
    InvalidTransitionError,
    PlannedAction,
    Remediations,
    UngroundedError,
)
from harbour_control.policy import ACTIONS, TARGETS, TOOL_CLASSES, PolicyError, ToolClass

INSTRUCTIONS = """You are connected to harbour-control, the control plane of the Gullrock Ferries \
booking system.
Read tools query ClickStack telemetry. propose_remediation stores a proposal that a human must
approve; execute_remediation only succeeds after that approval. Submit a finding before you propose.
Always cite trace ids that a tool returned. Never claim an action ran unless execute_remediation \
returned its result."""

CHANGE_DESCRIPTION = (
    'What changed: {"kind": "release", "value": "v2"} for a release, {"kind": "config", '
    '"value": "<config version>"} for a config push, or {"kind": "none", "value": ""} when '
    "nothing changed."
)
PARAMS_DESCRIPTION = (
    'Action parameters. rollback_release needs {"release": "<release to deploy>"}; '
    'rollback_config needs {"version": "previous"}.'
)


class UnclassifiedToolError(ValueError):
    pass


def tool_annotations(name: str) -> ToolAnnotations:
    """The MCP hints for a tool, derived from how the policy classifies it."""
    tool_class = TOOL_CLASSES.get(name)
    if tool_class is None:
        raise UnclassifiedToolError(f"{name} is not in policy.TOOL_CLASSES")
    return ToolAnnotations(
        read_only_hint=tool_class is ToolClass.READ,
        destructive_hint=tool_class is ToolClass.ACTION,
        idempotent_hint=tool_class is not ToolClass.RECORD,
        open_world_hint=False,
    )


def one_line_description(function: Callable) -> str | None:
    """A docstring wrapped to fit the editor, joined back into the one line clients show."""
    if function.__doc__ is None:
        return None
    return " ".join(function.__doc__.split())


def sre_tool(mcp: FastMCP):
    def register(function):
        name = function.__name__
        annotations = tool_annotations(name)
        add_tool = mcp.tool(
            name=name, description=one_line_description(function), annotations=annotations
        )
        return add_tool(function)

    return register


class ModelArgumentsTool(FunctionTool):
    """A tool whose Python function takes one model, while MCP clients send its fields flat.

    A tool with many arguments reads better as one model than as a long parameter list, but
    clients must still see each field as its own top-level argument.
    """

    async def run(self, arguments: dict[str, Any]) -> Any:
        return await super().run({"arguments": arguments})


def add_model_tool(mcp: FastMCP, function: Callable, arguments_model: type[BaseModel]) -> None:
    name = function.__name__
    tool = ModelArgumentsTool.from_function(
        function,
        name=name,
        description=one_line_description(function),
        annotations=tool_annotations(name),
    )
    model_schema = TypeAdapter(arguments_model).json_schema()
    flat_schema = compress_schema(model_schema, prune_titles=True)
    mcp.add_tool(tool.model_copy(update={"parameters": flat_schema}))


class FindingArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    incident_id: Annotated[str, Field(description="The incident id, for example inc-1a2b3c4d5e6f.")]
    service: Annotated[
        str,
        Field(description="The service whose telemetry shows the fault, as telemetry names it."),
    ]
    change: Annotated[dict[str, str], Field(description=CHANGE_DESCRIPTION)]
    pattern: Annotated[
        str, Field(description="The log or error pattern that is new in the incident window.")
    ]
    trace_ids: Annotated[
        list[str], Field(description="Two or more trace ids exactly as a tool returned them.")
    ]
    hypothesis: Annotated[str, Field(description="One sentence: what fails, where, and why.")]
    quote: Annotated[
        str, Field(description="One failing log line, copied word for word from a tool result.")
    ] = ""
    ruled_out: Annotated[
        list[dict[str, str]] | None,
        Field(
            description='Signals you checked and ruled out, each {"signal": "...", "why": "..."}.'
        ),
    ] = None


class ProposalArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    incident_id: Annotated[str, Field(description="The incident id.")]
    finding_id: Annotated[str, Field(description="The finding_id that submit_finding returned.")]
    action: Annotated[str, Field(description="One of get_incident's allowed_actions keys.")]
    target: Annotated[str, Field(description="A target listed for that action in allowed_actions.")]
    params: Annotated[dict[str, str] | None, Field(description=PARAMS_DESCRIPTION)] = None


def jsonable(value: Any) -> Any:
    if isinstance(value, dt.datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, float | decimal.Decimal):
        return round(float(value), 4)
    if isinstance(value, list | tuple):
        return [jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: jsonable(item) for key, item in value.items()}
    return value


def row_reader(telemetry) -> Callable[..., list[dict]]:
    """Run a named query and keep only the first rows, rounded, so replies stay small."""

    def rows(name: str, limit: int = 20, **params) -> list[dict]:
        return jsonable(telemetry.rows(name, **params)[:limit])

    return rows


def build_mcp(
    *, telemetry, remediations: Remediations, token: str | None, public_url: str = ""
) -> FastMCP:
    auth = None
    if token:
        auth = StaticTokenVerifier(tokens={token: {"client_id": "ai-sre", "scopes": []}})
    mcp = FastMCP("harbour-control", instructions=INSTRUCTIONS, auth=auth)
    rows = row_reader(telemetry)
    add_overview_tools(mcp, rows)
    add_evidence_tools(mcp, rows)
    add_incident_tools(mcp, remediations, public_url)
    add_finding_tools(mcp, remediations, public_url)
    add_execute_tool(mcp, remediations)
    return mcp


def add_overview_tools(mcp: FastMCP, rows: Callable[..., list[dict]]) -> None:
    tool = sre_tool(mcp)

    @tool
    def list_sources(minutes: int = 60) -> dict:
        """List the services reporting telemetry, their releases, span and error counts."""
        return {"services": rows("list_services", minutes=minutes), "tables": rows("list_tables")}

    @tool
    def service_timeseries(service: str, minutes: int = 15, bucket_s: int = 30) -> dict:
        """Requests, errors, error rate and p95 latency per time bucket for one service."""
        buckets = rows(
            "service_timeseries", 60, service=service, minutes=minutes, bucket_s=bucket_s
        )
        return {"service": service, "buckets": buckets}

    @tool
    def analyze_service_anomalies(baseline_minutes: int = 10) -> dict:
        """Compare each service's last minute with a 3 sigma bound over its trailing baseline."""
        return {
            "services": rows(
                "analyze_service_anomalies", baseline_minutes=baseline_minutes, min_delta=0.05
            )
        }

    @tool
    def get_event_deltas(service: str, incident_minutes: int = 5) -> dict:
        """What changed: new or growing log patterns, failing endpoints by release, and failing
        traces."""
        window = {"service": service, "incident_minutes": incident_minutes}
        return {
            "log_patterns": rows("get_event_deltas", 10, **window),
            "span_changes": rows("error_span_deltas", 10, **window),
            "releases": rows("errors_by_release", service=service, minutes=incident_minutes * 3),
            "failing_traces": rows(
                "sample_error_traces", 5, service=service, minutes=incident_minutes
            ),
        }


def add_evidence_tools(mcp: FastMCP, rows: Callable[..., list[dict]]) -> None:
    tool = sre_tool(mcp)

    @tool
    def event_patterns(service: str, minutes: int = 10) -> dict:
        """Cluster recent logs for one service into patterns with counts and an example each."""
        return {
            "service": service,
            "patterns": rows("event_patterns", 15, service=service, minutes=minutes),
        }

    @tool
    def get_trace_waterfall(trace_id: str) -> dict:
        """One trace: every span in start order (service, duration, status, SQL) and its
        correlated logs."""
        spans = rows("get_trace_waterfall", 50, trace_id=trace_id)
        logs = rows("trace_logs", 50, trace_id=trace_id)
        if not spans and not logs:
            raise ToolError(f"no spans or logs found for trace {trace_id}")
        result = {"trace_id": trace_id, "spans": spans, "logs": logs}
        if not spans:
            result["note"] = (
                "No spans: a span is exported when its request finishes, so a request that is "
                "still hanging has only its logs. That absence is itself evidence of a hang."
            )
        return result

    @tool
    def search_logs(service: str, text: str, minutes: int = 60) -> dict:
        """Find log lines for one service containing a word or phrase (case-insensitive),
        newest first."""
        return {"logs": rows("search_logs", 25, service=service, text=text, minutes=minutes)}

    @tool
    def slo_burn(service: str, slo: float = 0.995) -> dict:
        """Error budget burn rate over the last hour and the last six hours for one service."""
        return {
            "service": service,
            "slo": slo,
            "burn": rows("slo_burn", 1, service=service, slo=slo),
        }


def incident_overview(remediations: Remediations, incident_id: str) -> dict:
    """An incident's findings and remediations, plus what the policy lets the agent do next."""
    actions = [
        {
            "action_id": action.action_id,
            "state": action.state,
            "action": action.action,
            "target": action.target,
        }
        for action in remediations.actions_for(incident_id)
    ]
    allowed = {action: sorted(targets) for action, targets in ACTIONS.items()}
    findings = [
        {
            "finding_id": finding.finding_id,
            "service": finding.service,
            "change": finding.change,
            "hypothesis": finding.hypothesis,
        }
        for finding in remediations.findings_for(incident_id)
    ]
    return {
        "findings": findings,
        "remediations": actions,
        "allowed_actions": allowed,
        "targets": TARGETS,
    }


def add_incident_tools(mcp: FastMCP, remediations: Remediations, public_url: str) -> None:
    tool = sre_tool(mcp)
    store = remediations.store

    @tool
    def list_incidents(state: str = "open") -> dict:
        """List incidents opened by the detector. state is open, resolved or all."""
        matching = [
            incident for incident in store.incidents() if state == "all" or incident.state == state
        ]
        return {"incidents": [jsonable(vars(incident)) for incident in matching[:20]]}

    @tool
    def get_incident(incident_id: str) -> dict:
        """One incident with its summary, detector evidence and every remediation proposed for
        it."""
        try:
            incident = store.incident(incident_id)
        except KeyError as err:
            raise ToolError(f"no incident {incident_id}") from err
        overview = incident_overview(remediations, incident_id)
        return {"incident": jsonable(vars(incident)), **overview}

    @tool
    def get_remediation_status(action_id: str) -> dict:
        """The approval state of a proposed remediation, its result, and whether recovery was
        verified."""
        try:
            status = remediations.status(action_id)
        except KeyError as err:
            raise ToolError(f"no remediation {action_id}") from err
        return jsonable(
            {
                "action_id": status.action_id,
                "state": status.state,
                "action": status.action,
                "target": status.target,
                "params": status.params,
                "result": status.result,
                "verification": status.verification,
                "approval_url": f"{public_url}/actions/{status.action_id}",
            }
        )


def add_finding_tools(mcp: FastMCP, remediations: Remediations, public_url: str) -> None:
    def submit_finding(arguments: FindingArguments) -> dict:
        """Record your diagnosis. It is checked against telemetry and refused if any evidence is
        not real."""
        report = FindingReport(
            incident_id=arguments.incident_id,
            service=arguments.service,
            change=arguments.change,
            pattern=arguments.pattern,
            trace_ids=arguments.trace_ids,
            hypothesis=arguments.hypothesis,
            quote=arguments.quote,
            ruled_out=arguments.ruled_out or [],
        )
        try:
            finding = remediations.submit_finding(report, submitted_by="ai-sre")
        except UngroundedError as err:
            raise ToolError(f"finding refused: {err}") from err
        return {
            "finding_id": finding.finding_id,
            "next": "Propose one remediation for this finding, or none if nothing changed.",
        }

    def propose_remediation(arguments: ProposalArguments) -> dict:
        """Store a remediation for a human to approve. It does not run anything."""
        plan = PlannedAction(arguments.action, arguments.target, arguments.params or {})
        try:
            proposal = remediations.propose(
                incident_id=arguments.incident_id,
                finding_id=arguments.finding_id,
                plan=plan,
                proposed_by="ai-sre",
            )
        except (UngroundedError, PolicyError) as err:
            raise ToolError(f"proposal refused: {err}") from err
        return {
            "action_id": proposal.action_id,
            "state": proposal.state,
            "approval_url": f"{public_url}/actions/{proposal.action_id}",
            "next": "Share the approval_url. Wait for the human to confirm approval before "
            "executing.",
        }

    add_model_tool(mcp, submit_finding, FindingArguments)
    add_model_tool(mcp, propose_remediation, ProposalArguments)


def add_execute_tool(mcp: FastMCP, remediations: Remediations) -> None:
    tool = sre_tool(mcp)

    @tool
    def execute_remediation(action_id: str) -> dict:
        """Run a remediation a human has approved. Refused, and recorded, if it is not
        approved."""
        try:
            result = remediations.execute(action_id, executed_by="ai-sre")
        except (ApprovalRequiredError, InvalidTransitionError) as err:
            raise ToolError(str(err)) from err
        except KeyError as err:
            raise ToolError(f"no remediation {action_id}") from err
        return {
            "action_id": action_id,
            "result": result,
            "next": "Recovery is verified automatically over the next minute; "
            "check get_remediation_status.",
        }
