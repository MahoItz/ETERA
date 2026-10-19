import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_REFRESH, loadChatInbox, refreshChat, type ChatInboxData, type ChatThread } from "./chat";
import { supabase } from "./supabase";

const empty: ChatInboxData = { threads: [], unread_count: 0, has_more: false };
const mergeThreads = (current: ChatThread[], added: ChatThread[]) =>
  [...new Map([...current, ...added].map(thread => [thread.id, thread])).values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id));

export function useChatInbox(userId: string | null) {
  const [state, setState] = useState({ ...empty, owner: userId, loading: Boolean(userId), error: "", loadingMore: false });
  const moreRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setState({ ...empty, owner: userId, loading: Boolean(userId), error: "", loadingMore: false });
    if (!userId) return;
    let controller: AbortController | undefined;
    let stopped = false;
    const update = async (event?: Event) => {
      if (event instanceof CustomEvent && event.detail?.userId === userId) {
        setState(previous => ({ ...previous, threads: previous.threads.map(thread => thread.id === event.detail.conversationId ? { ...thread, unread_count: 0 } : thread) }));
      }
      if (document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      try {
        const result = await loadChatInbox(signal);
        if (!stopped && !signal.aborted) setState(previous => ({ ...previous, ...result, has_more: previous.threads.length > 50 ? previous.has_more : result.has_more, owner: userId, threads: mergeThreads(previous.threads, result.threads), loading: false, error: "" }));
      } catch (error) {
        if (!stopped && !signal.aborted) setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : "Не удалось загрузить сообщения." }));
      }
    };
    void update();
    const interval = window.setInterval(() => void update(), 15000);
    window.addEventListener(CHAT_REFRESH, update);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    const channel = supabase.channel(`chat-inbox-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, () => void update())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_reads", filter: `user_id=eq.${userId}` }, () => void update())
      .subscribe(status => { if (status === "SUBSCRIBED") void update(); });
    return () => {
      stopped = true; controller?.abort(); moreRequest.current?.abort();
      window.clearInterval(interval); window.removeEventListener(CHAT_REFRESH, update); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const loadMore = useCallback(async () => {
    if (!userId || state.owner !== userId || !state.has_more || state.loadingMore) return;
    const controller = new AbortController(); moreRequest.current = controller;
    setState(previous => ({ ...previous, loadingMore: true }));
    try {
      const result = await loadChatInbox(controller.signal, state.threads.at(-1));
      if (!controller.signal.aborted) setState(previous => ({ ...previous, threads: mergeThreads(previous.threads, result.threads), has_more: result.has_more, unread_count: result.unread_count, error: "" }));
    } catch (error) {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, error: error instanceof Error ? error.message : "Не удалось загрузить сообщения." }));
    } finally {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, loadingMore: false }));
    }
  }, [userId, state]);
  const current = state.owner === userId ? state : { ...empty, loading: Boolean(userId), error: "", loadingMore: false };
  return { ...current, loadMore, refresh: refreshChat };
}

export type ChatInboxState = ReturnType<typeof useChatInbox>;
