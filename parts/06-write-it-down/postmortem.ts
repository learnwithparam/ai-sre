// Reads a postmortem file: its incident id, its sections and its timeline lines.
import { field, read } from "../../checks/lib/files";

export const POSTMORTEM = "postmortems/bad-release.md";

export type TimelineLine = { clock: string; kind: string; text: string };

export function incidentIdIn(folder: string, fileName = POSTMORTEM): string {
  return field(read(folder, fileName), "Incident").toLowerCase();
}

// The text under one "## Heading" (or "### Heading"), up to the next heading of any level.
export function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => {
    const title = line.replace(/^#{2,3}\s+/, "").trim();
    return /^#{2,3}\s/.test(line) && title.toLowerCase() === heading.toLowerCase();
  });
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,3}\s/.test(line));
  const body = end < 0 ? rest : rest.slice(0, end);
  return body.join("\n").trim();
}

export function hasHeading(text: string, heading: string): boolean {
  const pattern = new RegExp(`^#{2,3}\\s+${heading}\\s*$`, "im");
  return pattern.test(text);
}

// A timeline line reads: - 22:17:52 incident_opened: the detector paged on-call.
const LINE = /^\s*[-*]\s+`?(\d{2}:\d{2}:\d{2})`?\s+`?([a-z_]+)`?:?\s*(.*)$/;

export function timelineLines(text: string): TimelineLine[] {
  const lines: TimelineLine[] = [];
  for (const line of section(text, "Timeline").split("\n")) {
    const found = line.match(LINE);
    if (found) lines.push({ clock: found[1], kind: found[2], text: found[3] });
  }
  return lines;
}

// "Label: 131" anywhere in a block of text, as a number, or NaN when it is missing.
export function numberAfter(text: string, label: string): number {
  const found = text.match(new RegExp(`${label}\\s*:\\s*\\**\\s*([\\d,]+)`, "i"));
  if (!found) return Number.NaN;
  return Number(found[1].replace(/,/g, ""));
}

// "Label: 22:10:35" anywhere in a block of text, or "" when it is missing.
export function clockAfter(text: string, label: string): string {
  const found = text.match(new RegExp(`${label}\\s*:\\s*\\**\\s*\`?(\\d{2}:\\d{2}:\\d{2})`, "i"));
  return found ? found[1] : "";
}
