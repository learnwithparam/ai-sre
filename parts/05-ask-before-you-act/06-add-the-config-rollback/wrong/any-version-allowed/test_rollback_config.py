"""Tests for rollback_config. Each test calls validate_action from the policy."""

import pytest
from harbour_control.policy import BLAST_RADIUS, PolicyError, validate_action


def test_the_previous_fare_table_is_allowed():
    validate_action("rollback_config", "fares", {"version": "previous"})


def test_a_named_fare_file_is_refused():
    with pytest.raises(PolicyError):
        validate_action("rollback_config", "fares", {"version": "fares-41"})


def test_a_path_is_refused():
    with pytest.raises(PolicyError):
        validate_action("rollback_config", "fares", {"version": "../../.env"})


def test_another_target_is_refused():
    with pytest.raises(PolicyError):
        validate_action("rollback_config", "timetable", {"version": "previous"})


def test_the_approver_sees_who_is_affected():
    assert "route" in BLAST_RADIUS["rollback_config"]
