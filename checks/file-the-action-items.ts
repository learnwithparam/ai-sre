// file-the-action-items: postmortems/actions.yaml holds the action items as rows. Each one has an
// owner, a due marker and the eval case it adds, so the next part can test the AI SRE on it.
import { auditRows, INCIDENT_ID } from "../parts/06-write-it-down/records";
import type { Rule } from "../scripts/verify";
import { read } from "./lib/files";

const FILE = "postmortems/actions.yaml";
const KINDS = ["prevent", "detect", "mitigate"];
const DUE_MARKERS = ["before-next-release", "next-planning", "next-incident-review"];
const PLACEHOLDER_OWNERS = /^(|tbd|todo|tba|none|nobody|everyone|all|someone|team|the team|\?+)$/i;
const CASE_NAME = /^evals\/incidents\/[a-z0-9]+(-[a-z0-9]+)*$/;

type Item = {
  action?: unknown;
  kind?: unknown;
  owner?: unknown;
  due?: unknown;
  // biome-ignore lint/style/useNamingConvention: eval_case is the field name in the YAML file.
  eval_case?: unknown;
};
type ActionsFile = { incident?: unknown; items?: Item[] };

function actionsFile(folder: string): ActionsFile {
  try {
    const parsed = Bun.YAML.parse(read(folder, FILE)) as ActionsFile | null;
    return parsed ?? {};
  } catch {
    return {};
  }
}

const items = (folder: string): Item[] => {
  const found = actionsFile(folder).items;
  return Array.isArray(found) ? found : [];
};

const words = (value: unknown) => String(value ?? "").trim();
const everyItem = (folder: string, test: (item: Item) => boolean) =>
  items(folder).length > 0 && items(folder).every(test);

export default [
  {
    says: `${FILE} names an incident that is in the audit log`,
    test: async (folder) => {
      const incident = words(actionsFile(folder).incident);
      if (!INCIDENT_ID.test(incident)) return false;
      return (await auditRows(folder, incident)).length > 0;
    },
    tryNext: "set incident: to the id on the Incident: line of your postmortem",
  },
  {
    says: "it lists at least two items",
    test: (folder) => items(folder).length >= 2,
    tryNext: "copy each line of your postmortem's Action items into items:, one entry each",
  },
  {
    says: "every item says what changes, and is a prevent, detect or mitigate item",
    test: (folder) =>
      everyItem(
        folder,
        (item) => words(item.action).length > 10 && KINDS.includes(words(item.kind)),
      ),
    tryNext: `write a full action: sentence and set kind: to one of ${KINDS.join(", ")}`,
  },
  {
    says: "every item has a real owner",
    test: (folder) => everyItem(folder, (item) => !PLACEHOLDER_OWNERS.test(words(item.owner))),
    tryNext:
      "name the one team or role that does it, such as booking team; " +
      "TBD and everyone mean nobody does it",
  },
  {
    says: `every item is due at a marker: ${DUE_MARKERS.join(", ")}`,
    test: (folder) => everyItem(folder, (item) => DUE_MARKERS.includes(words(item.due))),
    tryNext: `set due: to one of ${DUE_MARKERS.join(", ")}`,
  },
  {
    says: "every item names the eval case it adds, and one of them is evals/incidents/bad-release",
    test: (folder) => {
      const cases = items(folder).map((item) => words(item.eval_case));
      const named = cases.length > 0 && cases.every((name) => CASE_NAME.test(name));
      return named && cases.includes("evals/incidents/bad-release");
    },
    tryNext:
      "set eval_case: to the test that proves the fix, such as evals/incidents/bad-release; " +
      "an item with no test can quietly come undone",
  },
  {
    says: "at least one item prevents the cause and one detects it sooner",
    test: (folder) => {
      const kinds = items(folder).map((item) => words(item.kind));
      return kinds.includes("prevent") && kinds.includes("detect");
    },
    tryNext: "add a prevent item for the root cause and a detect item for the late page",
  },
] satisfies Rule[];
