// Intentionally closed vocabulary: never persist URLs, query strings, bodies,
// exception messages, account identifiers, headers or arbitrary user agents.
export const diagnosticKinds = ["network", "http", "slow", "body", "catalog", "render"] as const;
export const diagnosticServices = ["rest", "auth", "app"] as const;
export const diagnosticResources = ["catalog_cards", "site_settings", "categories", "category_list_state", "tree_ornaments", "works", "profiles", "favorites", "favorite_counts", "rpc", "auth", "catalog", "render", "other"] as const;
export type Diagnostic = {
  id: string; occurred_at: string;
  kind: typeof diagnosticKinds[number]; service: typeof diagnosticServices[number];
  resource: typeof diagnosticResources[number]; method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "HEAD" | "OTHER";
  status: number; duration_ms: number; online: boolean;
  browser: "Edge" | "Chrome" | "Firefox" | "Safari" | "Other";
  platform: "Android" | "iOS" | "Windows" | "macOS" | "Linux" | "Other";
  build: string;
};
const KEY = "elveria:diagnostics:v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGE = 7 * 86400000;
export function validDiagnostic(value: unknown, now = Date.now()): value is Diagnostic {
  if (!value || typeof value !== "object") return false;
  const d = value as Diagnostic;
  const time = Date.parse(d.occurred_at);
  return Object.keys(d).length === 12 && typeof d.id === "string" && UUID.test(d.id) && typeof d.occurred_at === "string" && Number.isFinite(time) && time >= now - AGE && time <= now + 300000
    && diagnosticKinds.includes(d.kind) && diagnosticServices.includes(d.service) && diagnosticResources.includes(d.resource)
    && ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OTHER"].includes(d.method)
    && Number.isInteger(d.status) && (d.status === 0 || (d.status >= 100 && d.status <= 599))
    && Number.isInteger(d.duration_ms) && d.duration_ms >= 0 && d.duration_ms <= 3600000
    && typeof d.online === "boolean" && ["Edge", "Chrome", "Firefox", "Safari", "Other"].includes(d.browser)
    && ["Android", "iOS", "Windows", "macOS", "Linux", "Other"].includes(d.platform)
    && typeof d.build === "string" && /^[a-zA-Z0-9._-]{1,40}$/.test(d.build);
}
export function diagnosticDevice(ua: string): Pick<Diagnostic, "browser" | "platform"> {
  return {
    browser: /Edg\//.test(ua) ? "Edge" : /Firefox\/|FxiOS\//.test(ua) ? "Firefox" : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Other",
    platform: /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Other",
  };
}
export function diagnosticEndpoint(input: string, base: string): Pick<Diagnostic, "service" | "resource"> | null {
  try {
    const url = new URL(input), origin = new URL(base).origin;
    if (url.origin !== origin) return null;
    if (url.pathname.startsWith("/auth/v1/")) return { service: "auth", resource: "auth" };
    if (!url.pathname.startsWith("/rest/v1/")) return null;
    const name = url.pathname.slice("/rest/v1/".length).split("/")[0];
    // Never instrument the reporter or admin reader: avoids recursive reports.
    if (/^\/rest\/v1\/rpc\/(record_site_diagnostic|admin_site_diagnostics)$/.test(url.pathname)) return null;
    return { service: "rest", resource: diagnosticResources.includes(name as Diagnostic["resource"]) ? name as Diagnostic["resource"] : "other" };
  } catch { return null; }
}
export function createDiagnosticQueue(storage: Pick<Storage, "getItem" | "setItem">, now = Date.now) {
  let memory: Diagnostic[] = [];
  let storageAvailable = true;
  const read = () => {
    if (!storageAvailable) return;
    try {
      const saved: unknown = JSON.parse(storage.getItem(KEY) ?? "[]");
      if (Array.isArray(saved)) memory = saved.filter(d => validDiagnostic(d, now())).slice(-20);
    } catch { storageAvailable = false; }
  };
  read();
  const persist = () => { if (storageAvailable) try { storage.setItem(KEY, JSON.stringify(memory)); } catch { storageAvailable = false; } };
  const list = () => { read(); memory = memory.filter(d => validDiagnostic(d, now())); persist(); return [...memory]; };
  return {
    list,
    add(event: Diagnostic) {
      if (!validDiagnostic(event, now())) return null;
      const recent = list().find(d => d.kind === event.kind && d.resource === event.resource && d.service === event.service && d.status === event.status && now() - Date.parse(d.occurred_at) < 60000);
      if (recent) return recent;
      memory = [...memory.filter(d => d.id !== event.id), event].slice(-20); persist();
      return event;
    },
    remove(id: string) { list(); memory = memory.filter(d => d.id !== id); persist(); },
  };
}
