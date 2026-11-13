"""The runner can only build the commands policy allows, with no shell and no free text."""

import pytest

from harbour_control.policy import PolicyError
from harbour_control.runner import build_command

PROJECT = "/srv/ai-sre"


def test_rollback_redeploys_the_previous_release():
    cmd, env = build_command("rollback_release", "booking-web", {"release": "v1"}, PROJECT)
    assert cmd == [
        "docker", "compose", "-p", "gullrock", "--env-file", f"{PROJECT}/.env",
        "-f", f"{PROJECT}/world/compose.yml",
        "up", "-d", "--no-deps", "--wait", "booking-web",
    ]  # fmt: skip
    assert env == {"BOOKING_RELEASE": "v1"}


def test_restart_restarts_one_named_service():
    cmd, env = build_command("restart_service", "timetable-loader", {}, PROJECT)
    assert cmd[-2:] == ["restart", "timetable-loader"]
    assert env == {}


@pytest.mark.parametrize(
    ("action", "target", "params"),
    [
        ("restart_service", "clickstack", {}),
        ("restart_service", "docs-loader; reboot", {}),
        ("rollback_release", "booking-web", {"release": "v2"}),
        ("rollback_release", "booking-web", {"release": "v1", "extra": "x"}),
        ("exec", "booking-web", {}),
    ],
)
def test_anything_else_is_refused(action, target, params):
    with pytest.raises(PolicyError):
        build_command(action, target, params, PROJECT)


def test_config_rollback_restores_the_previous_file(tmp_path):
    from harbour_control.runner import ComposeRunner

    history = tmp_path / "world" / ".state" / "fares" / "history"
    history.mkdir(parents=True)
    (history / "0001-fares-41.json").write_text("41")
    (history / "0002-fares-42.json").write_text("42")
    (tmp_path / "world" / ".state" / "fares" / "current.json").write_text("42")
    result = ComposeRunner(tmp_path).run("rollback_config", "fares", {"version": "previous"})
    assert result["exit_code"] == 0
    assert (tmp_path / "world" / ".state" / "fares" / "current.json").read_text() == "41"
