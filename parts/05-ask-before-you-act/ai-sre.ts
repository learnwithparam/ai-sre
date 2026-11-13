// bun parts/05-ask-before-you-act/ai-sre.ts timetable-hang
//
// Runs the course's AI SRE on the open incident. With LLM_PROVIDER=replay (no key) it plays back
// a recorded run from cassettes/ in this folder. That run makes a real mistake on purpose: it
// proposes the wrong fix, so you can practise saying no. A live model may propose something else.
import { runAiSre } from "../../agent/ai-sre";
import { provider } from "../../config/models";

const CASSETTES = ["timetable-hang"];
const [scenario = ""] = process.argv.slice(2);

if (!CASSETTES.includes(scenario)) {
  console.log(`Name a scenario: ${CASSETTES.join(", ")}`);
  process.exit(1);
}

// agent/replay.ts looks for cassettes in agent/cassettes, so the path climbs out to this folder.
const cassette = `../../parts/05-ask-before-you-act/cassettes/${scenario}`;
console.log(`The AI SRE (${provider()} mode) investigates the open incident:`);
await runAiSre("Investigate the open incident. Find the cause and propose one change.", cassette);
console.log("\nNothing ran. Open Harbour Control at http://localhost:8090 to decide.");
