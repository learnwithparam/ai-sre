// The two pages a passenger sees.
// The footer names the release and fare table, so a rollback shows on screen.
import type { Sailing } from "./store";

const PLACES: Record<string, string> = {
  "port-maren": "Port Maren",
  gullrock: "Gullrock",
  "skerry-head": "Skerry Head",
};
const placeName = (placeId: string) => PLACES[placeId] ?? placeId;

const shell = (title: string, body: string, release: string, fares: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { --sea:#0f4c5c; --foam:#e8f1f2; --ink:#14232a; --line:#c9d6d9;
    --ok:#1d7a46; --bad:#a23b2a; }
  * { box-sizing: border-box; }
  body { margin:0; font: 16px/1.5 system-ui, sans-serif;
    color: var(--ink); background: var(--foam); }
  header { background: var(--sea); color: #fff; padding: 16px; }
  header h1 { margin: 0; font-size: 22px; } header p { margin: 4px 0 0; opacity: .85; }
  main { max-width: 760px; margin: 0 auto; padding: 16px; }
  table { width: 100%; border-collapse: collapse; background: #fff; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); }
  form { background: #fff; padding: 16px; margin-top: 16px; display: grid; gap: 10px;
    border: 1px solid var(--line); }
  label { display: grid; gap: 4px; font-weight: 600; }
  input, select, button { font: inherit; padding: 8px; }
  button { background: var(--sea); color: #fff; border: 0; cursor: pointer; }
  #result { font-weight: 600; min-height: 1.5em; }
  .ok { color: var(--ok); } .bad { color: var(--bad); }
  footer { max-width: 760px; margin: 0 auto; padding: 16px; color: #4a5b60; font-size: 14px; }
</style></head>
<body><header><h1>Gullrock Ferries</h1><p>Port Maren, Gullrock and Skerry Head</p></header>
<main>${body}</main>
<footer id="release">Release ${release} · fares ${fares}</footer>
</body></html>`;

function routeName(sailing: Sailing): string {
  return `${placeName(sailing.route_from)} to ${placeName(sailing.route_to)}`;
}

function sailingRow(sailing: Sailing): string {
  const cells = [sailing.departs, routeName(sailing), sailing.vessel, sailing.car_spaces];
  return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
}

function sailingOption(sailing: Sailing): string {
  return `<option value="${sailing.id}">${sailing.departs} ${routeName(sailing)}</option>`;
}

export function bookingPage(sailings: Sailing[], release: string, fares: string): string {
  const rows = sailings.map(sailingRow).join("");
  const options = sailings.map(sailingOption).join("");
  return shell(
    "Book a sailing | Gullrock Ferries",
    `
<h2>Sailings</h2>
<table>
<thead><tr><th>Departs</th><th>Route</th><th>Vessel</th><th>Car spaces</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<form id="book">
  <h2>Book a sailing</h2>
  <label>Sailing <select name="sailing_id">${options}</select></label>
  <label>Vehicle <select name="vehicle">
    <option value="car">Car</option><option value="foot">Foot passenger</option>
    <option value="bicycle">Bicycle</option><option value="van">Van</option>
  </select></label>
  <label>Name <input name="name" required value="Ana Ferreira"></label>
  <label>Email <input name="email" type="email" required value="ana@example.test"></label>
  <label>Card number <input name="card" required value="4000 0000 0000 0001"></label>
  <button type="submit">Book and pay</button>
  <p id="result" role="status"></p>
</form>
<p><a href="/checkin">Check in at the quay</a></p>
<script>
document.getElementById("book").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = document.getElementById("result");
  const form = Object.fromEntries(new FormData(event.target));
  const response = await fetch("/api/bookings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(form),
  });
  const body = await response.json();
  result.className = body.ok ? "ok" : "bad";
  if (!body.ok) {
    result.textContent = body.error;
    return;
  }
  const pounds = (body.fare_pence / 100).toFixed(2);
  result.textContent = "Booked. Your reference is " + body.ref + " (" + pounds + " GBP)";
});
</script>`,
    release,
    fares,
  );
}

export function checkinPage(release: string, fares: string): string {
  return shell(
    "Check in | Gullrock Ferries",
    `
<form id="checkin">
  <h2>Check in at the quay</h2>
  <label>Booking reference <input name="ref" required placeholder="GR-XXXXXX"></label>
  <button type="submit">Check in</button>
  <p id="result" role="status"></p>
</form>
<script>
document.getElementById("checkin").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = document.getElementById("result");
  const form = Object.fromEntries(new FormData(event.target));
  const response = await fetch("/api/checkin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(form),
  });
  const body = await response.json();
  result.className = body.ok ? "ok" : "bad";
  result.textContent = body.ok ? "Checked in: " + body.ref + ". Join lane 3." : body.error;
});
</script>`,
    release,
    fares,
  );
}
