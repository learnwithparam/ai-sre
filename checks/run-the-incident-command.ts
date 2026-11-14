// run-the-incident-command: incident/command.md holds the three roles, the state of the incident
// and a list of timed updates. The check reads the shape, and that the updates keep their order.
import type { Rule } from "../scripts/verify";
import { field, hasReason, read } from "./lib/files";

const FILE = "incident/command.md";
const STATUSES = ["investigating", "mitigating", "monitoring", "resolved"];
const PLACEHOLDER = /^(|tbd|todo|tba|me|none|nobody|someone|\?+)$/i;
const CLOCK = /^(\d{2}):(\d{2})$/;

type Update = { clock: string; text: string };

function updates(folder: string): Update[] {
  const section = read(folder, FILE).split(/^## Updates/m)[1] ?? "";
  const found: Update[] = [];
  for (const line of section.split("\n")) {
    const match = line.match(/^- (\d{2}:\d{2})(?: UTC)?\s+(.*)$/);
    if (match) found.push({ clock: match[1], text: match[2] });
  }
  return found;
}

const roleNames = (folder: string) =>
  ["Commander", "Scribe", "Comms"].map((role) => field(read(folder, FILE), role));
const minutes = (clock: string) => {
  const match = clock.match(CLOCK);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
};

export default [
  {
    says: "the Commander, the Scribe and the Comms role each have a real name",
    test: (folder) => roleNames(folder).every((name) => !PLACEHOLDER.test(name)),
    tryNext: "write one name after each of Commander:, Scribe: and Comms:",
  },
  {
    says: "three different people hold the three roles",
    test: (folder) => {
      const names = roleNames(folder).map((name) => name.toLowerCase());
      return names.every(Boolean) && new Set(names).size === 3;
    },
    tryNext: "give each role to a different person; the Commander does not also write the notes",
  },
  {
    says: "the Status is investigating, mitigating, monitoring or resolved",
    test: (folder) => STATUSES.includes(field(read(folder, FILE), "Status").toLowerCase()),
    tryNext: `set Status: to one of ${STATUSES.join(", ")}`,
  },
  {
    says: "the Impact line says who is hurt, in four words or more",
    test: (folder) => hasReason(field(read(folder, FILE), "Impact")),
    tryNext: "write what passengers see, such as Some passengers cannot finish a booking",
  },
  {
    says: "the Next update line has a time like 22:30",
    test: (folder) => CLOCK.test(field(read(folder, FILE), "Next update").replace(/ UTC$/, "")),
    tryNext: "set Next update: to the time of your next message, such as 22:30 UTC",
  },
  {
    says: "there are at least three updates, each with a time and four words or more",
    test: (folder) => {
      const found = updates(folder);
      return found.length >= 3 && found.every((update) => hasReason(update.text));
    },
    tryNext: "under ## Updates write lines like - 22:17 UTC Paged; checking the last release",
  },
  {
    says: "the updates are in time order",
    test: (folder) => {
      const times = updates(folder).map((update) => minutes(update.clock));
      return times.length > 0 && times.every((time, i) => i === 0 || time >= times[i - 1]);
    },
    tryNext: "put the oldest update first and the newest last",
  },
  {
    says: "one update says what is not known yet",
    test: (folder) =>
      updates(folder).some((update) => /not (yet )?(known|sure)|do not know|unknown/i.test(update.text)),
    tryNext: "say plainly what you do not know yet, such as We do not know the cause yet",
  },
] satisfies Rule[];
