// bun parts/03-look-without-touching/try-insert.ts
// Tries to write one log line into ClickHouse as sre_agent, the user every AI SRE query runs
// as, and prints what ClickHouse answers. The password comes from .env and is never printed.
import { chQuery, chReachable } from "../../world/lib/clickhouse";

const INSERT = "INSERT INTO otel_logs (ServiceName, Body) VALUES ('booking-web', 'hello')";

if (!(await chReachable())) {
  console.log("ClickHouse is not running. Start the world with bun run world.");
  process.exit(1);
}
console.log(`As sre_agent: ${INSERT}`);
try {
  await chQuery(INSERT);
  console.log("ClickHouse accepted the INSERT. sre_agent can write: that must never happen.");
  process.exit(1);
} catch (error) {
  console.log("ClickHouse refused it:");
  console.log(`  ${(error as Error).message}`);
}
