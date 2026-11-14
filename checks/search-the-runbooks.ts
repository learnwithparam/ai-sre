// search-the-runbooks: the learner searches two files, runbooks.md and past-incidents.md, for the
// runbook and the past incident that match one symptom. The check finds the best match itself.
import type { Rule } from "../scripts/verify";
import { field, read } from "./lib/files";

const ANSWER = "answers/search-the-runbooks.md";
const STOP = new Set(["the", "a", "are", "is", "of", "to", "and", "in", "fatal"]);

type Section = { title: string; body: string };

function sections(text: string, prefix: RegExp): Section[] {
  const found: Section[] = [];
  for (const part of text.split(/^## /m).slice(1)) {
    const [title, ...rest] = part.split("\n");
    const body = rest.join("\n");
    if (prefix.test(title)) found.push({ title: title.trim(), body });
  }
  return found;
}

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !STOP.has(word));

function best(found: Section[], symptom: string): Section | undefined {
  const want = new Set(words(symptom));
  const score = (section: Section) =>
    words(`${section.title} ${section.body}`).filter((word) => want.has(word)).length;
  return [...found].sort((left, right) => score(right) - score(left))[0];
}

const runbooks = (folder: string) => sections(read(folder, "runbooks.md"), /^Runbook:/);
const pastOnes = (folder: string) => sections(read(folder, "past-incidents.md"), /^inc-/);
const symptom = (folder: string) => field(read(folder, ANSWER), "Symptom");

export default [
  {
    says: "the answer shows the search you ran, with grep or rg",
    test: (folder) => /\b(grep|rg)\b/.test(field(read(folder, ANSWER), "Search")),
    tryNext:
      'write a line such as Search: grep -i "connection slots" runbooks.md past-incidents.md',
  },
  {
    says: "the named runbook is the one that matches the symptom",
    test: (folder) => {
      const named = field(read(folder, ANSWER), "Runbook").toLowerCase();
      const right = best(runbooks(folder), symptom(folder));
      return Boolean(right) && named === right?.title.replace(/^Runbook:\s*/, "").toLowerCase();
    },
    tryNext:
      "copy the title after Runbook: from the ## heading of the runbook that names your symptom",
  },
  {
    says: "the past incident is in past-incidents.md and has the same cause",
    test: (folder) => {
      const id = field(read(folder, ANSWER), "Past incident");
      const right = best(pastOnes(folder), symptom(folder));
      return Boolean(right) && id === right?.title.split(/\s/)[0];
    },
    tryNext: "search past-incidents.md for the symptom words and copy the id, such as inc-0312",
  },
  {
    says: "the quote is three words or more and comes from that runbook",
    test: (folder) => {
      const quote = field(read(folder, ANSWER), "Quote").toLowerCase();
      const right = best(runbooks(folder), symptom(folder));
      return quote.split(/\s+/).length >= 3 && Boolean(right?.body.toLowerCase().includes(quote));
    },
    tryNext: "copy a line from the runbook word for word, so a reader can trust you read it",
  },
] satisfies Rule[];
