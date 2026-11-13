// bun run check: the repo standard. CI runs this; any failure stops the build.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { allSteps, type Part, parts, ROOT, type Step } from "./structure";

const errors: string[] = [];
const fail = (where: string, what: string) =>
  errors.push(`${relative(ROOT, where) || "."}: ${what}`);
const read = (path: string) => readFileSync(path, "utf8");

const STEP_SECTIONS = [
  "## The problem",
  "## Your challenge",
  "## Done when",
  "## If you get stuck",
  "## Words you will use",
];
// Written as a code so this file does not hold the character it rejects.
const EM_DASH = String.fromCharCode(0x2014);
const HYPE = new RegExp(
  [
    "\\b(supercharge|unleash|unlock|seamless(ly)?|leverage|dive into|game[- ]changer",
    "|revolutioni[sz]e|magic(al)?|cutting[- ]edge|AI-powered)\\b",
  ].join(""),
  "i",
);
const TIME_WORDS = /\b(week|day|hour)\s+\d+\b/i;
const VERB_THING = /^[a-z]+(-[a-z0-9]+)+$/;
const IMAGE = /!\[[^\]]*\]\(([^)\s]+)\)/g;
const MERMAID = /```mermaid\n/;
const MODEL_ID = /\b(claude-[a-z0-9-]+-\d|gpt-\d[\w.-]*|gemini-\d[\w.-]*|o\d-(mini|pro)\b)/i;

const hasImage = (text: string) => [...text.matchAll(IMAGE)].length > 0;

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else found.push(path);
  }
  return found;
}

// 1. No Makefile anywhere.
function checkNoMakefile(files: string[]) {
  for (const file of files) {
    if (/(^|\/)(GNU)?[Mm]akefile$/.test(file)) {
      fail(file, "a Makefile is not allowed; use a Bun or uv script");
    }
  }
}

// 2. Prose rules on every Markdown file.
function checkProseLine(file: string, line: string, lineNumber: number) {
  if (line.includes(EM_DASH)) fail(file, `line ${lineNumber}: em dash`);
  const hype = line.match(HYPE);
  if (hype) fail(file, `line ${lineNumber}: hype word "${hype[0]}"`);
  const timeWord = line.match(TIME_WORDS);
  if (timeWord && !file.includes("schedules")) {
    fail(file, `line ${lineNumber}: "${timeWord[0]}"; content is in parts, schedules map time`);
  }
  if (/\bM=\d+|verify \d+/.test(line)) {
    fail(file, `line ${lineNumber}: numeric step command; name the step`);
  }
}

function checkProse(markdownFiles: string[]) {
  for (const file of markdownFiles) {
    const lines = read(file).split("\n");
    for (let i = 0; i < lines.length; i++) checkProseLine(file, lines[i], i + 1);
  }
}

// 2b. Every page shows, not only tells: images it names exist, and the key pages carry a
// picture.
function checkImagesExist(markdownFiles: string[]) {
  for (const file of markdownFiles) {
    for (const match of read(file).matchAll(IMAGE)) {
      const target = match[1];
      if (/^https?:/.test(target)) continue;
      if (!existsSync(join(dirname(file), target))) fail(file, `image "${target}" does not exist`);
    }
  }
}

function needPicture(file: string, what: string, mermaid: boolean, image: boolean) {
  if (!existsSync(file)) return fail(file, "missing");
  const text = read(file);
  if (mermaid && !MERMAID.test(text)) fail(file, `${what} needs a Mermaid diagram`);
  if (image && !hasImage(text)) fail(file, `${what} needs a screenshot`);
}

// 3. Parts and steps.
function checkPartReadme(part: Part, readme: string) {
  if (!existsSync(readme)) return fail(part.dir, "part has no README.md");
  const text = read(readme);
  if (!MERMAID.test(text)) fail(readme, "part README needs a Mermaid diagram");
  const walkthrough = text.split("## Walkthrough")[1]?.split("\n## ")[0];
  if (walkthrough === undefined) fail(readme, `part README needs a "## Walkthrough" section`);
  else if (!walkthrough.includes("```bash")) {
    fail(readme, "the walkthrough needs the commands, each with an Expect: line");
  }
}

function checkPart(part: Part, seenNames: Set<string>) {
  const readme = join(part.dir, "README.md");
  checkPartReadme(part, readme);
  // A part skeleton waits for its own build session; it says so with TODO(part session) in
  // its README.
  const pending = existsSync(readme) && read(readme).includes("TODO(part session)");
  if (part.steps.length === 0 && !pending) fail(part.dir, "part has no steps");
  if (part.steps.length > 0 && pending) {
    fail(readme, "the part has steps but its README still says TODO(part session)");
  }
  for (const step of part.steps) checkStep(step, seenNames);
}

function checkStepNameAndMeta(step: Step, seenNames: Set<string>) {
  if (!VERB_THING.test(step.name)) {
    fail(step.dir, `step name "${step.name}" must be verb-thing in lower case`);
  }
  if (seenNames.has(step.name)) fail(step.dir, `step name "${step.name}" is used twice`);
  seenNames.add(step.name);
  if (!existsSync(join(step.dir, "step.toml"))) fail(step.dir, "missing step.toml");
  const minutes = step.meta.minutes;
  if (minutes < 5 || minutes > 30) {
    fail(step.dir, `step is ${minutes} min; keep a step between 5 and 30, split it if longer`);
  }
}

function checkStepReadme(step: Step, stepReadme: string) {
  const text = read(stepReadme);
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words > 600) {
    fail(stepReadme, `${words} words; a step README stays under 600, split the step`);
  }
  for (const heading of STEP_SECTIONS) {
    if (!text.includes(heading)) fail(stepReadme, `missing section "${heading}"`);
  }
  if (!MERMAID.test(text) && !hasImage(text)) {
    fail(stepReadme, "a step shows a picture: a screenshot or a Mermaid diagram");
  }
  const doneWhen = text.split("## Done when")[1]?.split("\n## ")[0] ?? "";
  if (!/^- /m.test(doneWhen)) fail(stepReadme, "Done when needs at least one bullet");
  if (step.meta.screen) checkScreenshot(step, stepReadme, text);
}

function checkScreenshot(step: Step, stepReadme: string, text: string) {
  const screenshot = join(step.dir, "images", "expected.png");
  if (!existsSync(screenshot)) fail(step.dir, "screen step needs images/expected.png");
  if (!text.includes("images/expected.png")) {
    fail(stepReadme, "screen step must show ../images/expected.png");
  }
}

function checkStep(step: Step, seenNames: Set<string>) {
  checkStepNameAndMeta(step, seenNames);
  const stepReadme = join(step.dir, "problem", "README.md");
  if (!existsSync(stepReadme)) return fail(step.dir, "missing problem/README.md");
  checkStepReadme(step, stepReadme);
  if (step.meta.solution && !existsSync(join(step.dir, "solution"))) {
    fail(step.dir, "step.toml says solution but there is no solution/");
  }
  const hasTsCheck = existsSync(join(ROOT, "checks", `${step.name}.ts`));
  const hasPyCheck = existsSync(join(ROOT, "checks", `${step.name}.py`));
  if (!hasTsCheck && !hasPyCheck) fail(step.dir, `no check at checks/${step.name}.ts`);
}

// 4. Commands: the README runs the finished system first, and every command block says what
// to expect.
function checkRootReadmeOrder() {
  const rootReadme = join(ROOT, "README.md");
  if (!existsSync(rootReadme)) return fail(ROOT, "missing README.md");
  const text = read(rootReadme);
  const firstCode = text.indexOf("```bash");
  const firstConcept = text.search(/^## (How it works|Concepts|Background|Why)/m);
  if (firstCode < 0) {
    fail(rootReadme, "the README needs a bash block that runs the finished system");
  } else if (firstConcept >= 0 && firstConcept < firstCode) {
    fail(rootReadme, "run the finished system before any concept section");
  }
}

function checkExpectLines(file: string) {
  const lines = read(file).split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "```bash") continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "```") j++;
    const nextText = lines.slice(j + 1).find((line) => line.trim() !== "");
    if (!nextText?.startsWith("Expect:")) {
      fail(file, `line ${i + 1}: a bash block must be followed by an Expect: line`);
    }
    i = j;
  }
}

// 5. One model config, exact pins, a troubleshooting table.
function checkModelIds(files: string[]) {
  const scanned = files.filter(
    (file) =>
      /\.(ts|py|md|json|toml|ya?ml)$/.test(file) &&
      !file.includes("/config/models.") &&
      !file.includes("/scripts/check.ts"),
  );
  for (const file of scanned) {
    const match = read(file).match(MODEL_ID);
    if (match) fail(file, `model id "${match[0]}" outside config/models; name models in one place`);
  }
}

function checkPins() {
  const pkg = join(ROOT, "package.json");
  if (existsSync(pkg)) {
    const manifest = JSON.parse(read(pkg));
    const versions: Record<string, string> = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    };
    for (const [name, version] of Object.entries(versions)) {
      if (!/^\d+\.\d+\.\d+$/.test(version)) fail(pkg, `${name}@${version}: pin an exact version`);
    }
  }
  const pyproject = join(ROOT, "pyproject.toml");
  if (!existsSync(pyproject)) return;
  for (const match of read(pyproject).matchAll(/"([A-Za-z0-9_.\-[\]]+)\s*(>=|~=|\^|>|<)[^"]*"/g)) {
    fail(pyproject, `${match[1]}: pin with == not ${match[2]}`);
  }
}

function checkTroubleshootingTable() {
  const trouble = join(ROOT, "00-orientation", "troubleshooting.md");
  const tableHeader = /\| *What you see *\| *What it means *\| *Fix *\|/;
  if (!existsSync(trouble) || !tableHeader.test(read(trouble))) {
    fail(
      ROOT,
      "00-orientation/troubleshooting.md needs a table: What you see | What it means | Fix",
    );
  }
}

// 6. Every schedule covers every part, and the minutes add up.
type Session = { parts: string[]; minutes: number };
type Schedules = Record<string, { sessions: Session[] }>;

// partMinutes lists every part in course order with the minutes its steps add up to.
function checkSchedule(
  schedPath: string,
  format: string,
  schedule: { sessions: Session[] },
  partMinutes: Record<string, number>,
) {
  const listed = schedule.sessions.flatMap((session) => session.parts);
  for (const partName of Object.keys(partMinutes)) {
    if (!listed.includes(partName)) fail(schedPath, `${format} leaves out part "${partName}"`);
  }
  for (const session of schedule.sessions) {
    const need = session.parts.reduce((total, name) => total + (partMinutes[name] ?? 0), 0);
    if (need > session.minutes) {
      fail(schedPath, `${format}: a session needs ${need} min but has ${session.minutes}`);
    }
  }
}

function checkSchedules(allParts: Part[]) {
  const schedPath = join(ROOT, "schedules.toml");
  if (!existsSync(schedPath)) return fail(ROOT, "missing schedules.toml");
  const schedules = Bun.TOML.parse(read(schedPath)) as Schedules;
  const partMinutes: Record<string, number> = {};
  for (const part of allParts) {
    partMinutes[part.name] = part.steps.reduce((total, step) => total + step.meta.minutes, 0);
  }
  for (const [format, schedule] of Object.entries(schedules)) {
    checkSchedule(schedPath, format, schedule, partMinutes);
  }
}

const files = walk(ROOT);
const markdownFiles = files.filter((file) => file.endsWith(".md"));
checkNoMakefile(files);
checkProse(markdownFiles);
checkImagesExist(markdownFiles);
needPicture(join(ROOT, "README.md"), "the root README", true, true);
needPicture(join(ROOT, "00-orientation", "README.md"), "the orientation", false, true);

const allParts = parts();
if (allParts.length === 0) fail(join(ROOT, "parts"), "no parts");
const seenNames = new Set<string>();
for (const part of allParts) checkPart(part, seenNames);

checkRootReadmeOrder();
for (const file of markdownFiles) checkExpectLines(file);
checkModelIds(files);
checkPins();
checkTroubleshootingTable();
checkSchedules(allParts);

if (errors.length) {
  console.log(`The repo does not meet the standard. ${errors.length} problem(s):`);
  for (const message of errors) console.log(`  - ${message}`);
  process.exit(1);
}
console.log(
  `The repo meets the standard: ${allParts.length} part(s), ${allSteps().length} step(s).`,
);
