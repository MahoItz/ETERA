import { useEffect, useRef, useState } from "react";
import { findWorkConversation } from "./chat";
import { ChatConversation } from "./ChatConversation";

export function WorkChat({ workId, title, userId, onLogin }: { workId: string; title: string; userId: string | null; onLogin: () => void }) {
  const [conversationId, setConversationId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => panel.current?.querySelector("textarea")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [workId]);
  useEffect(() => {
    setConversationId(undefined); setError(""); setLoading(false);
    if (!userId) return;
    const controller = new AbortController();
    setLoading(true);
    findWorkConversation(workId, userId, controller.signal).then(id => {
      if (!controller.signal.aborted) setConversationId(id);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить переписку.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workId, userId, retry]);
  return <div className="work-chat" ref={panel}>
      <div className="chat-thread-context"><h3>{title}</h3><p>Переписка с мастером об этой работе.</p></div>
      {loading && <p className="chat-hint" role="status">Ищем вашу переписку…</p>}
      {error && <div className="chat-error"><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Повторить загрузку</button></div>}
      <ChatConversation conversationId={conversationId} workId={workId} userId={userId} onLogin={onLogin} blocked={loading || Boolean(error)} />
  </div>;
}
