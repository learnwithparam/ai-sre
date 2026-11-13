// Read the learner's files. A missing file reads as empty, so a rule fails with its own try-next
// line.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function read(folder: string, fileName: string): string {
  const path = join(folder, fileName);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

// "Label: value" lines, as the answers files use.
export function field(text: string, label: string): string {
  const labelLine = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "mi");
  const found = text.match(labelLine);
  if (!found) return "";
  const value = found[1].trim();
  return value.replace(/^`|`$/g, "");
}

export const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// A reason needs a few real words. One letter such as "x" is not a reason.
export const MIN_REASON_WORDS = 4;

export function hasReason(text: string): boolean {
  const words = text.split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word));
  return words.length >= MIN_REASON_WORDS;
}
