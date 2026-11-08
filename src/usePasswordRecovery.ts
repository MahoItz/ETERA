import { useEffect, useRef, useState } from "react";
import { initialPasswordRecovery, supabase } from "./supabase";
import { clearPasswordRecoveryLink } from "../lib/password-recovery";

export type PasswordRecoveryState = "idle" | "checking" | "ready" | "invalid";

export function usePasswordRecovery() {
  const [state, setState] = useState<PasswordRecoveryState>(
    initialPasswordRecovery.requested ? "checking" : "idle",
  );
  const dismissed = useRef(false);

  useEffect(() => {
    let active = true;
    // Keep the callback synchronous: SDK calls here can wait on the auth lock.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (dismissed.current) return;
      if (event === "PASSWORD_RECOVERY") {
        const url = new URL(window.location.href);
        url.searchParams.set("auth", "recovery");
        history.replaceState(history.state, "", url.href);
        setState("ready");
      }
      if (event === "SIGNED_OUT") setState((current) => current === "ready" ? "invalid" : current);
    });

    if (initialPasswordRecovery.requested) {
      void (async () => {
        try {
          const initialized = await supabase.auth.initialize();
          if (initialized.error || initialPasswordRecovery.failed) {
            if (active && !dismissed.current) setState("invalid");
            return;
          }
          const { data, error } = await supabase.auth.getSession();
          if (active && !dismissed.current) setState(!error && data.session ? "ready" : "invalid");
        } catch {
          if (active && !dismissed.current) setState("invalid");
        }
      })();
    }
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  function close() {
    dismissed.current = true;
    history.replaceState(history.state, "", clearPasswordRecoveryLink(window.location.href));
    setState("idle");
  }

  return { state, close };
}
