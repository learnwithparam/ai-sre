// Read the learner's files. A missing file reads as empty, so a rule fails with its own try-next line.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const read = (dir: string, name: string) =>
  existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : "";

// "Label: value" lines, as the answers files use.
export function field(text: string, label: string): string {
  const m = text.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "mi"));
  return m ? m[1].trim().replace(/^`|`$/g, "") : "";
}

export const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
