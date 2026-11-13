// Every page a passenger or the on-call approver can open. Booking web is the audit's base URL.
// Harbour Control listens on its own port, so its routes carry the full address.
export type Route = { name: string; path: string };

const HARBOUR = "http://localhost:8090";

export const routes: Route[] = [
  { name: "booking", path: "/" },
  { name: "check-in", path: "/checkin" },
  { name: "harbour control sign in", path: `${HARBOUR}/login` },
];

// Button verbs this course uses beyond the shared list, in lower case.
export const extraButtonVerbs: string[] = ["book", "check", "sign", "approve", "reject", "edit"];
