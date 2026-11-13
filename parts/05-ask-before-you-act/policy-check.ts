// Runs a learner's policy.py inside a copy of harbour-control, so the add-the-config-rollback
// check can ask it questions and run the tests. The running world is never touched.
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../../world/lib/env";

const HARBOUR = join(ROOT, "world", "harbour-control");
// The Python environment lives in the temp folder, so no installed package lands in the repo.
const VENV = join(tmpdir(), "gullrock-harbour-control-venv");
const PYTHON = join(VENV, "bin", "python");
const PROBE = join(import.meta.dir, "probe_policy.py");
const STARTER = join(import.meta.dir, "06-add-the-config-rollback", "problem", "policy.py");

// biome-ignore-start lint/style/useNamingConvention: probe_policy.py prints snake_case keys.
export type PolicyAnswers = {
  previous_allowed: boolean;
  named_file_refused: boolean;
  path_refused: boolean;
  other_target_refused: boolean;
  blast_radius: string;
  target_described: boolean;
};
// biome-ignore-end lint/style/useNamingConvention: probe_policy.py prints snake_case keys.

function ensurePython(): void {
  if (existsSync(PYTHON)) return;
  // biome-ignore lint/style/useNamingConvention: environment variable names are upper case.
  const venvSetting = { UV_PROJECT_ENVIRONMENT: VENV };
  Bun.spawnSync(["uv", "sync", "--frozen", "--quiet"], {
    cwd: HARBOUR,
    env: { ...process.env, ...venvSetting },
  });
}

// A copy of harbour-control with one policy file swapped in, and optionally one more test.
function copyWith(policyFile: string, testFile = ""): string {
  const copy = mkdtempSync(join(tmpdir(), "harbour-policy-"));
  cpSync(join(HARBOUR, "harbour_control"), join(copy, "harbour_control"), { recursive: true });
  cpSync(join(HARBOUR, "tests"), join(copy, "tests"), { recursive: true });
  cpSync(join(HARBOUR, "sql"), join(copy, "sql"), { recursive: true });
  cpSync(policyFile, join(copy, "harbour_control", "policy.py"));
  cpSync(PROBE, join(copy, "probe_policy.py"));
  if (testFile) cpSync(testFile, join(copy, "tests", "test_rollback_config.py"));
  return copy;
}

function runPython(copy: string, args: string[]): { passed: boolean; output: string } {
  ensurePython();
  const run = Bun.spawnSync([PYTHON, ...args], { cwd: copy, stdout: "pipe", stderr: "pipe" });
  const output = run.stdout.toString() + run.stderr.toString();
  return { passed: run.exitCode === 0, output };
}

export function askPolicy(policyFile: string): PolicyAnswers | null {
  if (!existsSync(policyFile)) return null;
  const copy = copyWith(policyFile);
  try {
    const { passed, output } = runPython(copy, ["probe_policy.py"]);
    return passed ? JSON.parse(output) : null;
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

// Runs pytest on one test file, or on every harbour-control test when testPath is "tests".
export function testsPass(policyFile: string, testFile: string, testPath: string): boolean {
  if (!existsSync(policyFile) || (testFile && !existsSync(testFile))) return false;
  const copy = copyWith(policyFile, testFile);
  try {
    const pytest = ["-m", "pytest", "-q", "-p", "no:cacheprovider", testPath];
    return runPython(copy, pytest).passed;
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

export const starterPolicy = () => STARTER;
