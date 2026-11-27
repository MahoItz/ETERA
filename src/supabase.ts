import { createClient } from "@supabase/supabase-js";
import { passwordRecoveryLink } from "../lib/password-recovery";
import { diagnosticFetch, startDiagnostics } from "./diagnostics";

// Capture the callback before the SDK consumes and removes its URL fragment.
export const initialPasswordRecovery = passwordRecoveryLink(window.location.href);

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key)
  throw new Error(
    "Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY в .env.local.",
  );

export const supabase = createClient(url, key, {
  global: { fetch: diagnosticFetch(url) },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Send with the public key, independently of Auth refresh locks. Reporter calls
// bypass diagnosticFetch, preventing recursion when the service is unreachable.
startDiagnostics(async event => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5000);
  try {
    const result = await fetch(`${url}/rest/v1/rpc/record_site_diagnostic`, {
      method: "POST", headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ event }), signal: controller.signal, credentials: "omit",
    });
    const accepted: unknown = result.ok ? await result.json() : false;
    return accepted === true;
  } finally { clearTimeout(timer); }
});
