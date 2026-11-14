// map-the-topology: calls.csv lists each span with its service and its parent's service. The
// learner writes the edges between services in topology.txt. The check derives the edges itself.
import type { Rule } from "../scripts/verify";
import { read } from "./lib/files";

const FILE = "topology.txt";

function derived(folder: string): Set<string> {
  const edges = new Set<string>();
  for (const line of read(folder, "calls.csv").split("\n").slice(1)) {
    const [parent, child] = line.split(",").map((cell) => cell.trim());
    if (parent && child && parent !== child) edges.add(`${parent} -> ${child}`);
  }
  return edges;
}

function written(folder: string): string[] {
  return read(folder, FILE)
    .split("\n")
    .map((line) => line.trim().replace(/^- /, ""))
    .filter((line) => /^[a-z0-9-]+ -> [a-z0-9-]+$/.test(line));
}

export default [
  {
    says: "topology.txt lists at least one edge like booking-web -> postgres",
    test: (folder) => written(folder).length > 0,
    tryNext: "write one edge per line, such as - booking-web -> postgres",
  },
  {
    says: "every service call in calls.csv is an edge",
    test: (folder) => {
      const have = new Set(written(folder));
      const want = derived(folder);
      return want.size > 0 && [...want].every((edge) => have.has(edge));
    },
    tryNext: "read calls.csv again; each row where the two services differ is one edge",
  },
  {
    says: "no edge is invented, and no service calls itself",
    test: (folder) => {
      const want = derived(folder);
      return written(folder).every((edge) => want.has(edge));
    },
    tryNext: "delete an edge that has no row in calls.csv, and any edge from a service to itself",
  },
  {
    says: "the Entry line names the service nothing else calls",
    test: (folder) => {
      const edges = [...derived(folder)].map((edge) => edge.split(" -> "));
      const callers = new Set(edges.map((edge) => edge[0]));
      const callees = new Set(edges.map((edge) => edge[1]));
      const entry = [...callers].filter((name) => !callees.has(name))[0];
      const named = read(folder, FILE).match(/^Entry:\s*(\S+)/m)?.[1];
      return Boolean(entry) && named === entry;
    },
    tryNext: "add Entry: and the one service that is a caller but never a callee",
  },
] satisfies Rule[];
