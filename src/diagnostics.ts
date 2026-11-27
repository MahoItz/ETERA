import { createDiagnosticQueue, diagnosticDevice, diagnosticEndpoint, type Diagnostic } from "../lib/diagnostics";

const queue = createDiagnosticQueue({
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
});
let sender: ((event: Diagnostic) => Promise<boolean>) | null = null;
let sending = false;
let lastAttempt = 0;
let started = false;
let lastReport: Diagnostic | null = null;
const recent: Diagnostic[] = [];
export function recordDiagnostic(fields: Pick<Diagnostic, "kind" | "service" | "resource"> & Partial<Pick<Diagnostic, "method" | "status" | "duration_ms">>) {
  // Telemetry must never break a customer action, even in restrictive browsers.
  try {
    const event: Diagnostic = {
      id: crypto.randomUUID(), occurred_at: new Date().toISOString(),
      method: "OTHER", status: 0, duration_ms: 0, ...fields,
      online: navigator.onLine, ...diagnosticDevice(navigator.userAgent),
      build: import.meta.env.VITE_APP_BUILD || "local",
    };
    const saved = queue.add(event);
    if (!saved) return;
    lastReport = saved;
    if (!recent.some(d => d.id === saved.id)) recent.push(saved);
    if (recent.length > 20) recent.shift();
    window.dispatchEvent(new Event("elveria:diagnostics"));
    void flushDiagnostics();
  } catch { /* Reporting is best effort. */ }
}
export async function flushDiagnostics() {
  if (!sender || sending || !navigator.onLine || Date.now() - lastAttempt < 30000) return;
  const events = queue.list();
  if (!events.length) return;
  sending = true; lastAttempt = Date.now();
  try {
    for (const event of events) {
      if (!await sender(event)) break;
      queue.remove(event.id);
    }
  } catch { /* Keep the outbox for the next attempt. */ }
  finally { sending = false; }
}
export function startDiagnostics(send: (event: Diagnostic) => Promise<boolean>) {
  sender = send;
  if (started) return;
  started = true;
  window.addEventListener("online", () => { void flushDiagnostics(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void flushDiagnostics(); });
  window.setInterval(() => { if (document.visibilityState === "visible") void flushDiagnostics(); }, 60000);
  void flushDiagnostics();
}
export function diagnosticReportId() { return lastReport?.id ?? queue.list().at(-1)?.id ?? null; }
export function downloadDiagnosticReport() {
  const events = [...new Map([...queue.list(), ...recent].map(d => [d.id, d])).values()].slice(-20);
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, events }, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "elveria-diagnostics.json"; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Observe headers AND body completion. A small 401 can work while a larger
// catalogue body stalls. Only reads are aborted; writes are never retried here.
export function diagnosticFetch(base: string, nativeFetch: typeof fetch = window.fetch.bind(window), slowMs = 20000): typeof fetch {
  return async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const target = diagnosticEndpoint(href, base);
    if (!target) return nativeFetch(input, init);
    const rawMethod = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const method: Diagnostic["method"] = ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD"].includes(rawMethod) ? rawMethod as Diagnostic["method"] : "OTHER";
    const sourceSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const controller = new AbortController();
    const abort = () => controller.abort(sourceSignal?.reason);
    if (sourceSignal?.aborted) abort(); else sourceSignal?.addEventListener("abort", abort, { once: true });
    const start = performance.now();
    let status = 0, headersReceived = false, slow = false;
    const duration = () => Math.min(3600000, Math.round(performance.now() - start));
    const timer = window.setTimeout(() => {
      if (sourceSignal?.aborted) return;
      slow = true;
      recordDiagnostic({ ...target, kind: "slow", method, status, duration_ms: duration() });
      if (method === "GET" || method === "HEAD") controller.abort();
    }, slowMs);
    try {
      const response = await nativeFetch(input, { ...init, signal: controller.signal });
      status = response.status; headersReceived = true;
      if (!response.ok) recordDiagnostic({ ...target, kind: "http", method, status, duration_ms: duration() });
      if (status === 204 || method === "HEAD") return response;
      const bytes = await response.arrayBuffer();
      return new Response(bytes, { status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      if (!sourceSignal?.aborted && !slow) recordDiagnostic({ ...target, kind: headersReceived ? "body" : "network", method, status, duration_ms: duration() });
      throw error;
    } finally {
      clearTimeout(timer); sourceSignal?.removeEventListener("abort", abort);
    }
  };
}
