// The system of record: sailings and bookings. Postgres in the world, SQLite in a check.

import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { SQL } from "bun";

// biome-ignore-start lint/style/useNamingConvention: the field names are the database columns.
export type Booking = {
  ref: string;
  sailing_id: number;
  name: string;
  email: string;
  vehicle: string;
  fare_pence: number;
  status: string;
  created_at: string;
};
export type Sailing = {
  id: number;
  route_from: string;
  route_to: string;
  departs: string;
  vessel: string;
  car_spaces: number;
};
export type CheckinStore = { findBooking(ref: string): Promise<Booking | null> };

const tracer = trace.getTracer("booking-web");

// The sailings every fresh world starts with. Departure times are timetable data.
const SAILINGS: Omit<Sailing, "id">[] = [
  {
    route_from: "port-maren",
    route_to: "gullrock",
    departs: "06:40",
    vessel: "MV Kittiwake",
    car_spaces: 38,
  },
  {
    route_from: "port-maren",
    route_to: "gullrock",
    departs: "08:15",
    vessel: "MV Kittiwake",
    car_spaces: 38,
  },
  {
    route_from: "gullrock",
    route_to: "port-maren",
    departs: "09:50",
    vessel: "MV Kittiwake",
    car_spaces: 38,
  },
  {
    route_from: "gullrock",
    route_to: "skerry-head",
    departs: "10:30",
    vessel: "MV Puffin",
    car_spaces: 12,
  },
  {
    route_from: "skerry-head",
    route_to: "gullrock",
    departs: "12:05",
    vessel: "MV Puffin",
    car_spaces: 12,
  },
  {
    route_from: "port-maren",
    route_to: "skerry-head",
    departs: "13:20",
    vessel: "MV Fulmar",
    car_spaces: 24,
  },
  {
    route_from: "skerry-head",
    route_to: "port-maren",
    departs: "15:45",
    vessel: "MV Fulmar",
    car_spaces: 24,
  },
  {
    route_from: "port-maren",
    route_to: "gullrock",
    departs: "17:30",
    vessel: "MV Kittiwake",
    car_spaces: 38,
  },
];

// biome-ignore-end lint/style/useNamingConvention: the field names are the database columns.

export class Store implements CheckinStore {
  readonly sql: SQL;
  readonly system: "postgresql" | "sqlite";

  constructor(url: string) {
    this.sql = new SQL(url, { max: 10 });
    this.system = url.startsWith("sqlite") ? "sqlite" : "postgresql";
  }

  // Every query is a client span, so a slow statement shows up in the trace waterfall.
  async query<T>(name: string, text: string, run: () => Promise<T>): Promise<T> {
    return tracer.startActiveSpan(
      name,
      {
        kind: SpanKind.CLIENT,
        attributes: { "db.system.name": this.system, "db.query.text": text },
      },
      async (span) => {
        try {
          return await run();
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
          throw err;
        } finally {
          span.end();
        }
      },
    );
  }

  async migrate(): Promise<void> {
    const idColumn = this.system === "sqlite" ? "INTEGER PRIMARY KEY" : "SERIAL PRIMARY KEY";
    await this.sql.unsafe(`CREATE TABLE IF NOT EXISTS sailings (
      id ${idColumn}, route_from TEXT NOT NULL, route_to TEXT NOT NULL, departs TEXT NOT NULL,
      vessel TEXT NOT NULL, car_spaces INTEGER NOT NULL)`);
    await this.sql.unsafe(`CREATE TABLE IF NOT EXISTS bookings (
      ref TEXT PRIMARY KEY, sailing_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
      vehicle TEXT NOT NULL, fare_pence INTEGER NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, checked_in_at TEXT)`);
    const [{ total }] = await this.sql`SELECT count(*) AS total FROM sailings`;
    if (Number(total) > 0) return;
    for (const sailing of SAILINGS) await this.sql`INSERT INTO sailings ${this.sql(sailing)}`;
  }

  sailings(): Promise<Sailing[]> {
    return this.query(
      "SELECT sailings",
      "SELECT * FROM sailings ORDER BY departs",
      () => this.sql`SELECT * FROM sailings ORDER BY departs`,
    );
  }

  async sailing(id: number): Promise<Sailing | null> {
    const rows = await this.query(
      "SELECT sailings",
      "SELECT * FROM sailings WHERE id = $1",
      () => this.sql`SELECT * FROM sailings WHERE id = ${id}`,
    );
    return rows[0] ?? null;
  }

  async insertBooking(booking: Booking): Promise<void> {
    await this.query(
      "INSERT bookings",
      "INSERT INTO bookings (...) VALUES (...)",
      () => this.sql`INSERT INTO bookings ${this.sql(booking)}`,
    );
  }

  async findBooking(ref: string): Promise<Booking | null> {
    const rows = await this.query(
      "SELECT bookings",
      "SELECT * FROM bookings WHERE ref = $1",
      () => this.sql`SELECT * FROM bookings WHERE ref = ${ref}`,
    );
    return rows[0] ?? null;
  }

  async checkIn(ref: string): Promise<void> {
    const checkedInAt = new Date().toISOString();
    await this.query(
      "UPDATE bookings",
      "UPDATE bookings SET status = 'checked_in' WHERE ref = $1",
      () => this.sql`UPDATE bookings
        SET status = 'checked_in', checked_in_at = ${checkedInAt} WHERE ref = ${ref}`,
    );
  }

  async ping(): Promise<void> {
    await this.sql`SELECT 1`;
  }
}
