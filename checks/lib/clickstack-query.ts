// Reads one SQL statement on standard input, runs it in embedded ClickHouse, prints JSON rows.
import { query } from "chdb";

const sql = await Bun.stdin.text();
process.stdout.write(query(sql, "JSONEachRow"));
