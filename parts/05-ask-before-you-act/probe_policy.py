"""Asks a policy the questions the add-the-config-rollback check needs, and prints the answers.

The check copies this file next to the learner's harbour_control package and runs it there.
"""

import json

from harbour_control import policy


def refuses(action: str, target: str, params: dict[str, str]) -> bool:
    try:
        policy.validate_action(action, target, params)
    except policy.PolicyError:
        return True
    return False


def answers() -> dict[str, object]:
    blast_radius = policy.BLAST_RADIUS.get("rollback_config", "")
    return {
        "previous_allowed": not refuses(
            "rollback_config", "fares", {"version": "previous"}
        ),
        "named_file_refused": refuses(
            "rollback_config", "fares", {"version": "fares-41"}
        ),
        "path_refused": refuses("rollback_config", "fares", {"version": "../../.env"}),
        "other_target_refused": refuses(
            "rollback_config", "timetable", {"version": "previous"}
        ),
        "blast_radius": blast_radius,
        "target_described": "fares" in policy.TARGETS,
    }


if __name__ == "__main__":
    print(json.dumps(answers()))
