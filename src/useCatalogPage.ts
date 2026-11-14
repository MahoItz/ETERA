import { useEffect, useRef, useState } from "react";
import { CATALOG_PAGE_SIZE, loadCatalogPage, type CatalogPage } from "./catalog-pages";
import type { Work } from "../lib/model";
const emptyWorks: Work[] = [];

export function useCatalogPage({ initial, query, category, sort, scope, enabled }: {
  initial: CatalogPage | null; query: string; category: string; sort: string; scope: string; enabled: boolean;
}) {
  const key = JSON.stringify([query.trim(), category, sort, scope]);
  const [state, setState] = useState<CatalogPage & { key: string }>({ works: [], total: 0, key });
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [errorFromMore, setErrorFromMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const active = useRef<{ controller: AbortController; key: string; initial: CatalogPage | null } | null>(null);
  const pendingMore = useRef(false);
  const [moreLoading, setMoreLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const request = { controller, key, initial };
    active.current = request;
    pendingMore.current = false;
    setMoreLoading(false);
    setError("");
    setErrorFromMore(false);
    if (!enabled || !initial) { setLoading(false); return () => controller.abort(); }
    if (!query.trim() && !category && sort === "new" && scope === "published" && retry === 0) {
      setState({ ...initial, key });
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      loadCatalogPage({ query, category, sort, scope }, 0, CATALOG_PAGE_SIZE, controller.signal)
        .then(page => { if (!controller.signal.aborted) setState({ ...page, key }); })
        .catch(() => { if (!controller.signal.aborted) setError("Не удалось загрузить работы. Попробуйте снова."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query.trim() ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [initial, key, query, category, sort, scope, enabled, retry]);

  const matches = state.key === key && active.current?.initial === initial;
  async function more() {
    const request = active.current;
    if (!request || request.key !== key || !matches || pendingMore.current || loading || !enabled) return;
    pendingMore.current = true;
    setMoreLoading(true);
    setError("");
    try {
      const page = await loadCatalogPage({ query, category, sort, scope }, state.works.length, CATALOG_PAGE_SIZE, request.controller.signal);
      if (!request.controller.signal.aborted && active.current === request) {
        setState(previous => ({ key, total: page.total, works: [...new Map([...previous.works, ...page.works].map(work => [work.id, work])).values()] }));
      }
    } catch {
      if (!request.controller.signal.aborted) { setErrorFromMore(true); setError("Не удалось загрузить следующие работы. Попробуйте снова."); }
    } finally {
      if (active.current === request) { pendingMore.current = false; setMoreLoading(false); }
    }
  }
  return { works: matches ? state.works : emptyWorks, total: matches ? state.total : 0, loading: enabled && ((!matches && !error) || loading),
    error, moreLoading, more, reload: () => setRetry(value => value + 1), retry: () => errorFromMore ? void more() : setRetry(value => value + 1) };
}
