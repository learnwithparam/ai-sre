// Steady passengers: page views, bookings, check-ins and timetable look-ups, so every signal has a baseline.
// About 1 in 30 cards is declined: normal background noise that is never the cause of an incident.
const TARGET = (process.env.TARGET_URL ?? "http://localhost:8000").replace(/\/$/, "");
const RATE = Number(process.env.REQUESTS_PER_SECOND ?? 4);
const NAMES = [
  "Ana Ferreira",
  "Callum Reid",
  "Morag Sinclair",
  "Iain Mackay",
  "Priya Shah",
  "Tomasz Nowak",
  "Eilidh Ross",
  "Kwame Mensah",
];
const VEHICLES = ["car", "car", "car", "foot", "foot", "bicycle", "van"];
const ROUTES = ["port-maren", "gullrock", "skerry-head"];
const booked: string[] = [];
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

async function call(method: string, path: string, body?: unknown): Promise<any> {
  try {
    const res = await fetch(TARGET + path, {
      method,
      headers: { "content-type": "application/json", "user-agent": "gullrock-passengers/1" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    return res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  } catch {
    return null;
  }
}

async function once(): Promise<void> {
  const r = Math.random();
  if (r < 0.45) await call("GET", "/");
  else if (r < 0.8) {
    const name = pick(NAMES);
    const card = Math.random() < 1 / 30 ? "4000000000000002" : "4000000000000001";
    const email = `${name.split(" ")[0].toLowerCase()}.${Math.floor(Math.random() * 900 + 100)}@example.test`;
    const out = await call("POST", "/api/bookings", {
      name,
      email,
      sailing_id: String(1 + Math.floor(Math.random() * 8)),
      vehicle: pick(VEHICLES),
      card,
    });
    if (out?.ok) booked.push(out.ref);
    if (booked.length > 200) booked.shift();
  } else if (r < 0.92 && booked.length) {
    await call("POST", "/api/checkin", {
      ref: booked.splice(Math.floor(Math.random() * booked.length), 1)[0],
    });
  } else
    await call("GET", `/timetable?route=${pick(ROUTES)}&days=${1 + Math.floor(Math.random() * 7)}`);
}

console.log(`passengers: ${RATE} requests a second to ${TARGET}`);
while (true) {
  const started = Date.now();
  void once();
  await Bun.sleep(Math.max(0, 1000 / RATE - (Date.now() - started)));
}
