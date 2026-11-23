import { useEffect } from "react";
import { createTrafficTracker, trafficRoute } from "../lib/site-traffic";
import { supabase } from "./supabase";

// Lazy storage access also works in browsers that deny localStorage entirely.
const tracker = createTrafficTracker({
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
}, () => crypto.randomUUID());

export function useSiteTraffic(ready: boolean, admin: boolean) {
  const route = trafficRoute(window.location.href);
  useEffect(() => {
    if (!ready || admin || document.visibilityState !== "visible") return;
    const event = tracker(route, Date.now());
    if (event) void supabase.rpc("record_site_pageview", event).then(() => {}, () => {});
  }, [ready, admin, route]);
  useEffect(() => {
    if (!ready || admin) return;
    const record = () => {
      if (document.visibilityState !== "visible") return;
      const event = tracker(trafficRoute(window.location.href), Date.now());
      if (event) void supabase.rpc("record_site_pageview", event).then(() => {}, () => {});
    };
    window.addEventListener("popstate", record);
    document.addEventListener("visibilitychange", record);
    return () => {
      window.removeEventListener("popstate", record);
      document.removeEventListener("visibilitychange", record);
    };
  }, [ready, admin]);
}
