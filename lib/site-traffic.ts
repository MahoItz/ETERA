const INACTIVITY = 30 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Only the route is compared locally; URLs and account details are never sent.
export function trafficRoute(href: string): string | null {
  const url = new URL(href);
  if (url.searchParams.get("account") === "admin" || url.searchParams.has("type") || url.hash.includes("access_token")) return null;
  return JSON.stringify([url.pathname, url.searchParams.get("work")]);
}

export function createTrafficTracker(storage: Pick<Storage, "getItem" | "setItem">, uuid: () => string) {
  const memory = new Map<string, string>();
  let lastRoute: string | null = null;
  let lastActivity = 0;
  const read = (key: string) => {
    try { return storage.getItem(key) ?? memory.get(key); } catch { return memory.get(key); }
  };
  const write = (key: string, value: string) => {
    memory.set(key, value);
    try { storage.setItem(key, value); } catch { /* Storage may be disabled. */ }
  };
  return (route: string | null, now: number) => {
    if (route === null) { lastRoute = null; return null; }
    if (route === lastRoute && now - lastActivity < INACTIVITY) return null;
    let visitor = read("etera:traffic:v1:visitor");
    if (!visitor || !UUID.test(visitor)) {
      visitor = uuid();
      write("etera:traffic:v1:visitor", visitor);
    }
    let session = read("etera:traffic:v1:session");
    const previous = Number(read("etera:traffic:v1:activity"));
    if (!session || !UUID.test(session) || !previous || now - previous >= INACTIVITY || previous > now) {
      session = uuid();
      write("etera:traffic:v1:session", session);
    }
    write("etera:traffic:v1:activity", String(now));
    lastRoute = route;
    lastActivity = now;
    return { visitor_id: visitor, session_id: session, event_id: uuid() };
  };
}
