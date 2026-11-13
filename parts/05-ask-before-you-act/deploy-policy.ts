// bun parts/05-ask-before-you-act/deploy-policy.ts       run harbour-control with your policy.py
// bun parts/05-ask-before-you-act/deploy-policy.ts off   put the course's own policy back
//
// Copies one policy file into the running harbour-control container and restarts it, so the
// fare-file-push incident goes through your fixed list of actions.
import { join } from "node:path";
import { ROOT } from "../../world/lib/env";

const CONTAINER = "gullrock-harbour-control-1";
const INSIDE = "/app/harbour_control/policy.py";
const YOURS = join(import.meta.dir, "06-add-the-config-rollback", "problem", "policy.py");
const COURSE = join(ROOT, "world", "harbour-control", "harbour_control", "policy.py");

function docker(args: string[]): boolean {
  const run = Bun.spawnSync(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) console.log(run.stderr.toString().trim());
  return run.exitCode === 0;
}

async function healthy(): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const answer = await fetch("http://localhost:8090/healthz").catch(() => null);
    if (answer?.ok) return true;
    await Bun.sleep(2000);
  }
  return false;
}

const turnOff = process.argv[2] === "off";
const policy = turnOff ? COURSE : YOURS;
if (!docker(["cp", policy, `${CONTAINER}:${INSIDE}`]) || !docker(["restart", CONTAINER])) {
  console.log("Could not reach harbour-control. Is the world up? Run bun run world status.");
  process.exit(2);
}
if (!(await healthy())) {
  console.log("harbour-control did not start with this policy. Run the tests to see why.");
  console.log(
    "Then put the course policy back: bun parts/05-ask-before-you-act/deploy-policy.ts off",
  );
  process.exit(1);
}
const which = turnOff ? "the course's own policy" : "your policy.py";
console.log(`harbour-control is running ${which}.`);
