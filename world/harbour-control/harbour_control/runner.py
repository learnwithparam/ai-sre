"""Turns an approved action into one fixed command. No shell, no free text from the model."""

import shutil
import subprocess
from pathlib import Path
from typing import Any

from harbour_control.policy import validate_action

COMPOSE_FILE = "world/compose.yml"
PROJECT = "gullrock"


def build_command(action: str, target: str, params: dict[str, str], world_dir: str) -> tuple[list, dict]:
    validate_action(action, target, params)
    base = ["docker", "compose", "-p", PROJECT, "--env-file", f"{world_dir}/.env", "-f", f"{world_dir}/{COMPOSE_FILE}"]
    if action == "rollback_release":
        # Redeploying the previous release is `up` on the previous image tag, as a deploy system would.
        return [*base, "up", "-d", "--no-deps", "--wait", target], {"BOOKING_RELEASE": params["release"]}
    return [*base, "restart", target], {}


def rollback_config(world_dir: str) -> dict[str, Any]:
    """Copy the previous fare file back over the live one. booking-web rereads it within a request."""
    history = sorted((Path(world_dir) / "world" / ".state" / "fares" / "history").glob("*.json"))
    live = Path(world_dir) / "world" / ".state" / "fares" / "current.json"
    if len(history) < 2:
        return {"exit_code": 1, "command": "rollback_config fares previous", "output": "no previous fare table in history"}
    previous = history[-2]
    shutil.copyfile(previous, live)
    history[-1].unlink()
    return {"exit_code": 0, "command": "rollback_config fares previous", "output": f"restored {previous.name}"}


class ComposeRunner:
    def __init__(self, world_dir: Path, timeout_s: int = 180):
        self.world_dir, self.timeout_s = str(world_dir), timeout_s

    def run(self, action: str, target: str, params: dict[str, str]) -> dict[str, Any]:
        if action == "rollback_config":
            validate_action(action, target, params)
            return rollback_config(self.world_dir)
        cmd, extra_env = build_command(action, target, params, self.world_dir)
        env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "WORLD_DIR": self.world_dir, **extra_env}
        try:
            done = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=self.timeout_s)
        except subprocess.TimeoutExpired:
            return {"exit_code": -1, "command": " ".join(cmd), "output": f"timed out after {self.timeout_s}s"}
        output = (done.stdout + done.stderr)[-2000:]
        return {"exit_code": done.returncode, "command": " ".join(cmd), "output": output}
