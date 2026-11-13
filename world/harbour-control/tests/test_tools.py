"""Structural: every MCP tool is classified, and its MCP annotations say the same thing."""

import asyncio

import pytest
from fastmcp import FastMCP

from harbour_control.policy import TOOL_CLASSES, ToolClass
from harbour_control.tools import UnclassifiedToolError, build_mcp, sre_tool


def tools(remediations):
    mcp = build_mcp(telemetry=None, remediations=remediations, token=None)
    return {tool.name: tool for tool in asyncio.run(mcp.list_tools())}


def test_every_tool_is_classified(remediations):
    registered = tools(remediations)
    assert set(registered) == set(TOOL_CLASSES)
    for name, tool in registered.items():
        tool_class = TOOL_CLASSES[name]
        assert tool.annotations.read_only_hint is (tool_class is ToolClass.READ), name
        assert tool.annotations.destructive_hint is (tool_class is ToolClass.ACTION), name


def test_slo_burn_is_classified_read_only(remediations):
    assert TOOL_CLASSES["slo_burn"] is ToolClass.READ
    assert tools(remediations)["slo_burn"].annotations.read_only_hint is True


def test_a_proposal_cites_a_finding_not_free_text(remediations):
    schema = tools(remediations)["propose_remediation"].parameters
    assert "finding_id" in schema["required"]
    assert "root_cause" not in schema["properties"]


def test_an_unclassified_tool_cannot_register():
    with pytest.raises(UnclassifiedToolError):

        @sre_tool(FastMCP("probe"))
        def delete_everything() -> str:
            return "no"


def test_only_one_tool_can_act():
    acting = [name for name, tool_class in TOOL_CLASSES.items() if tool_class is ToolClass.ACTION]
    assert acting == ["execute_remediation"]


def test_every_remediation_target_names_its_service():
    from harbour_control.policy import ACTIONS, TARGETS

    assert {target for targets in ACTIONS.values() for target in targets} == set(TARGETS)
