// observe-the-agents-calls: agent-calls.jsonl has one line per tool call the AI SRE made. The
// learner counts them and finds the ones that need a human. The check counts them again.
import type { Rule } from "../scripts/verify";
import { field, read } from "./lib/files";

const ANSWER = "answers/observe-the-agents-calls.md";

type Call = { tool: string; kind: string; ok: boolean; ms: number; approved: boolean | null };

function calls(folder: string): Call[] {
  return read(folder, "agent-calls.jsonl")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Call);
}

const answer = (folder: string, label: string) => field(read(folder, ANSWER), label);

export default [
  {
    says: "Calls is the number of lines in agent-calls.jsonl",
    test: (folder) =>
      Number(answer(folder, "Calls")) === calls(folder).length && calls(folder).length > 0,
    tryNext: "count the lines of agent-calls.jsonl, for example with wc -l",
  },
  {
    says: "Failed calls is the number of calls with ok false",
    test: (folder) =>
      answer(folder, "Failed calls") === String(calls(folder).filter((call) => !call.ok).length),
    tryNext: 'count the lines that contain "ok":false',
  },
  {
    says: "Slowest tool is the tool of the call with the most milliseconds",
    test: (folder) => {
      const slow = [...calls(folder)].sort((left, right) => right.ms - left.ms)[0];
      return Boolean(slow) && answer(folder, "Slowest tool") === slow.tool;
    },
    tryNext: "look for the largest ms value and copy the tool name on that line",
  },
  {
    says: "Writes without approval counts write calls that were not approved",
    test: (folder) => {
      const loose = calls(folder).filter(
        (call) => call.kind === "write" && call.approved !== true,
      ).length;
      return answer(folder, "Writes without approval") === String(loose);
    },
    tryNext: 'count the lines with "kind":"write" where approved is not true',
  },
  {
    says: "the Action line says in four words or more what you would change",
    test: (folder) => answer(folder, "Action").split(/\s+/).filter(Boolean).length >= 4,
    tryNext: "write one sentence, such as Action: block every write call until a person approves",
  },
] satisfies Rule[];
