// Steady passengers: page views, bookings, check-ins and timetable look-ups,
// so every signal has a baseline.
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
const ACCEPTED_CARD = "4000000000000001";
const DECLINED_CARD = "4000000000000002";
const bookedRefs: string[] = [];

type BookingReply = { ok?: boolean; ref?: string } | null;

// A random whole number from `lowest` to `highest`, both included.
function randomWholeNumber(lowest: number, highest: number): number {
  return lowest + Math.floor(Math.random() * (highest - lowest + 1));
}

function pickOne<T>(choices: T[]): T {
  return choices[Math.floor(Math.random() * choices.length)];
}

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  try {
    const response = await fetch(TARGET + path, {
      method,
      headers: { "content-type": "application/json", "user-agent": "gullrock-passengers/1" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const isJson = response.headers.get("content-type")?.includes("json");
    return isJson ? await response.json() : null;
  } catch {
    return null;
  }
}

async function bookSailing(): Promise<void> {
  const name = pickOne(NAMES);
  const card = Math.random() < 1 / 30 ? DECLINED_CARD : ACCEPTED_CARD;
  const firstName = name.split(" ")[0].toLowerCase();
  const email = `${firstName}.${randomWholeNumber(100, 999)}@example.test`;
  const booking = {
    name,
    email,
    // biome-ignore lint/style/useNamingConvention: booking-web reads this snake_case JSON field.
    sailing_id: String(randomWholeNumber(1, 8)),
    vehicle: pickOne(VEHICLES),
    card,
  };
  const reply = (await call("POST", "/api/bookings", booking)) as BookingReply;
  if (reply?.ok && reply.ref) bookedRefs.push(reply.ref);
  if (bookedRefs.length > 200) bookedRefs.shift();
}

async function checkInBooking(): Promise<void> {
  const index = Math.floor(Math.random() * bookedRefs.length);
  const ref = bookedRefs.splice(index, 1)[0];
  await call("POST", "/api/checkin", { ref });
}

async function readTimetable(): Promise<void> {
  const days = randomWholeNumber(1, 7);
  await call("GET", `/timetable?route=${pickOne(ROUTES)}&days=${days}`);
}

// One passenger does one thing. The chances add up: 45% home page, 35% book, 12% check in.
async function onePassenger(): Promise<void> {
  const roll = Math.random();
  if (roll < 0.45) await call("GET", "/");
  else if (roll < 0.8) await bookSailing();
  else if (roll < 0.92 && bookedRefs.length) await checkInBooking();
  else await readTimetable();
}

console.log(`passengers: ${RATE} requests a second to ${TARGET}`);
while (true) {
  const started = Date.now();
  void onePassenger();
  await Bun.sleep(Math.max(0, 1000 / RATE - (Date.now() - started)));
}
