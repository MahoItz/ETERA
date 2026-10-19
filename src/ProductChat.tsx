import { useEffect, useId, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { findWorkConversation } from "./chat";
import { ChatConversation } from "./ChatConversation";

export function ProductChat({ workId, userId, onLogin }: { workId: string; userId: string | null; onLogin: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [conversationId, setConversationId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const regionId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const frame = requestAnimationFrame(() => panel.current?.querySelector("textarea")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [expanded]);
  useEffect(() => {
    setConversationId(undefined); setError(""); setLoading(false);
    if (!userId || !expanded) return;
    const controller = new AbortController();
    setLoading(true);
    findWorkConversation(workId, userId, controller.signal).then(id => {
      if (!controller.signal.aborted) setConversationId(id);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить переписку.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workId, userId, expanded, retry]);
  return <div className="product-chat">
    <button type="button" className="button primary" aria-expanded={expanded} aria-controls={regionId} onClick={() => setExpanded(value => !value)}><MessageCircle size={18} />{expanded ? "Свернуть переписку" : "Написать мастеру"}</button>
    <div id={regionId} ref={panel} hidden={!expanded}>
      {loading && <p className="chat-hint" role="status">Ищем вашу переписку…</p>}
      {error && <div className="chat-error"><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Повторить загрузку</button></div>}
      <ChatConversation conversationId={conversationId} workId={workId} userId={userId} onLogin={onLogin} blocked={loading || Boolean(error)} />
    </div>
  </div>;
}
