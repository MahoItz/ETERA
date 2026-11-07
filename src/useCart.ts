import { useCallback, useEffect, useRef, useState } from "react";
import type { CartItem } from "../lib/cart";
import { addCartItem, loadCart, removeCartItem } from "./cart-api";

export function useCart(userId: string | null) {
  const [state, setState] = useState<{ userId: string | null; items: CartItem[]; error: string; loading: boolean }>({ userId: null, items: [], error: "", loading: false });
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const actor = useRef(userId);
  actor.current = userId;
  const pending = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    let running = false;
    const update = async () => {
      if (running || document.hidden || pending.current) return;
      running = true;
      const version = generation.current;
      setState(previous => ({ ...previous, userId, items: previous.userId === userId ? previous.items : [], loading: true }));
      try {
        const items = await loadCart(userId, controller.signal);
        if (!controller.signal.aborted && version === generation.current) setState({ userId, items, error: "", loading: false });
      } catch (cause) {
        if (!controller.signal.aborted) setState(previous => ({ ...previous, userId, error: cause instanceof Error ? cause.message : "Не удалось загрузить корзину.", loading: false }));
      } finally { running = false; }
    };
    void update();
    const interval = window.setInterval(() => void update(), 15000);
    window.addEventListener("focus", update); document.addEventListener("visibilitychange", update);
    return () => { controller.abort(); window.clearInterval(interval); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, [userId, revision]);

  async function mutate(operation: (id: string) => Promise<void>) {
    const id = userId;
    if (!id) throw new Error("Войдите в аккаунт, чтобы пользоваться корзиной.");
    if (pending.current) return;
    pending.current = true; generation.current += 1; setBusy(true);
    try { await operation(id); }
    finally { pending.current = false; setBusy(false); refresh(); }
  }
  return {
    items: state.userId === userId && userId ? state.items : [],
    error: state.userId === userId ? state.error : "", loading: Boolean(userId && (state.userId !== userId || state.loading)), busy, refresh,
    add: (workId: string, variantId: string | null) => mutate(async id => {
      const item = await addCartItem(workId, variantId);
      if (actor.current === id) setState(previous => ({ userId: id, items: [...(previous.userId === id ? previous.items : []).filter(row => row.id !== item.id), item], error: "", loading: false }));
    }),
    remove: (itemId: string) => mutate(async id => {
      await removeCartItem(itemId, id);
      if (actor.current === id) setState(previous => ({ ...previous, items: previous.items.filter(item => item.id !== itemId) }));
    }),
  };
}
export type CartState = ReturnType<typeof useCart>;
