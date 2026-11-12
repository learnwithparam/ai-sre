// The fare table is configuration, pushed separately from code. booking-web rereads it when it changes.
import { existsSync, readFileSync, statSync } from "node:fs";
import { log } from "./otel";

export const FARE_ROW_LIMIT = 256; // the loader preallocates this many rows; a bigger file is refused

type FareRow = { from: string; to: string; vehicle: string; ticket: string; pence: number };
type FareFile = { version: string; rows: FareRow[] };

export class Fares {
  private rows: FareRow[] = [];
  version = "none";
  private seen = 0;

  constructor(private path: string, private faultCode = "") {}

  // Called on every request; rereads only when the file changed on disk.
  refresh(): void {
    if (!existsSync(this.path)) return;
    const mtime = statSync(this.path).mtimeMs;
    if (mtime === this.seen) return;
    this.seen = mtime;
    const file = JSON.parse(readFileSync(this.path, "utf8")) as FareFile;
    if (file.rows.length > FARE_ROW_LIMIT) {
      // The old table is dropped before the new one is checked, so every price reads as zero.
      this.rows = [];
      this.version = file.version;
      const ref = this.faultCode ? ` ref=${this.faultCode}` : "";
      log("error", `fare table rejected: ${file.rows.length} rows exceeds the limit of ${FARE_ROW_LIMIT} (config ${file.version})${ref}`, {
        "config.name": "fares",
        "config.version": file.version,
      });
      return;
    }
    this.rows = file.rows;
    this.version = file.version;
    log("info", `fare table loaded: ${file.rows.length} rows (config ${file.version})`, { "config.version": file.version });
  }

  price(from: string, to: string, vehicle: string, ticket = "adult"): number {
    return this.rows.find((r) => r.from === from && r.to === to && r.vehicle === vehicle && r.ticket === ticket)?.pence ?? 0;
  }
}
