"""Your tests for rollback_config. Each test calls validate_action from your policy."""

from harbour_control.policy import validate_action


def test_the_previous_fare_table_is_allowed():
    # Replace this line: call validate_action for rollback_config on fares, version previous.
    assert validate_action is not None
