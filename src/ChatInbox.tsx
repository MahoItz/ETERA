import { useEffect, useState } from "react";
import { ArrowLeft, MessageCircle, RefreshCw } from "lucide-react";
import { ChatDeletedError, loadChatThread, type ChatThread } from "./chat";
import type { ChatInboxState } from "./useChatInbox";
import { ChatConversation } from "./ChatConversation";
import { DeleteChatButton } from "./DeleteChatButton";

export function ChatInbox({ inbox, userId, admin, requestedId }: {
  inbox: ChatInboxState; userId: string; admin: boolean; requestedId: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(requestedId);
  const [fallback, setFallback] = useState<ChatThread | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  function deleted(id: string) {
    if (selectedId === id) { setSelectedId(null); setFallback(null); }
    setNotice("Чат удалён.");
  }
  useEffect(() => { setSelectedId(requestedId); }, [requestedId]);
  const thread = inbox.threads.find(item => item.id === selectedId) ?? fallback;
  useEffect(() => {
    setFallback(null); setError("");
    if (!selectedId || inbox.threads.some(item => item.id === selectedId)) return;
    const controller = new AbortController();
    loadChatThread(selectedId, controller.signal).then(result => { if (!controller.signal.aborted) setFallback(result); }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        if (cause instanceof ChatDeletedError) { setSelectedId(null); setFallback(null); setNotice(cause.message); }
        else setError(cause instanceof Error ? cause.message : "Не удалось открыть переписку.");
      }
    });
    return () => controller.abort();
  }, [selectedId, inbox.threads]);
  return <section className="chat-inbox" aria-label="Сообщения">
    <div className="chat-inbox-heading"><div><h2>Сообщения</h2><p>{admin ? "Вопросы покупателей и ваши ответы." : "Ваша переписка с мастером."}</p></div><button type="button" className="icon-button" aria-label="Обновить сообщения" onClick={inbox.refresh}><RefreshCw size={17} /></button></div>
    {notice && <p className="chat-hint" role="status">{notice}</p>}
    {inbox.error && <div className="chat-error"><p role="alert">{inbox.error}</p><button type="button" onClick={inbox.refresh}>Повторить загрузку</button></div>}
    {inbox.loading && <p className="chat-hint" role="status">Загружаем сообщения…</p>}
    {!inbox.loading && !inbox.threads.length && !selectedId && !inbox.error && <div className="chat-empty"><MessageCircle size={30} /><h3>Пока нет переписки</h3><p>{admin ? "Здесь появятся сообщения покупателей из карточек работ." : "Откройте понравившуюся работу и нажмите «Написать мастеру»."}</p></div>}
    {(inbox.threads.length > 0 || selectedId) && <div className={"chat-inbox-layout" + (selectedId ? " has-selection" : "")}>
      <div className="chat-thread-list" aria-label="Список переписок">
        {inbox.threads.map(item => <div className="chat-thread-row" key={item.id}><button type="button" className="chat-thread-select" aria-pressed={selectedId === item.id} onClick={() => { setSelectedId(item.id); setFallback(null); setNotice(""); }}>
          <span className="chat-thread-title">{item.work_title}{item.unread_count > 0 && <span className="chat-count" aria-label={`${item.unread_count} непрочитанных`}>{item.unread_count}</span>}</span>
          <span className="chat-thread-person">{item.participant_label}</span><span className="chat-thread-preview">{item.last_message}</span>
          <time dateTime={item.updated_at}>{new Date(item.updated_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
        </button><DeleteChatButton id={item.id} title={item.work_title} userId={userId} onDeleted={deleted} compact /></div>)}
        {inbox.has_more && <button type="button" className="chat-load-older" disabled={inbox.loadingMore} onClick={() => void inbox.loadMore()}>{inbox.loadingMore ? "Загружаем…" : "Ещё переписки"}</button>}
      </div>
      <div className="chat-thread-detail">
        {selectedId && <button type="button" className="chat-back" onClick={() => setSelectedId(null)}><ArrowLeft size={15} />Все переписки</button>}
        {error ? <p className="form-error" role="alert">{error}</p> : thread && selectedId ? <>
          <div className="chat-thread-context"><div className="chat-thread-heading"><h3>{thread.work_title}</h3><DeleteChatButton id={selectedId} title={thread.work_title} userId={userId} onDeleted={deleted} /></div><p>{thread.participant_label}</p>{!thread.work_id && <small>Работа удалена из каталога. Переписка сохранена.</small>}</div>
          <ChatConversation key={`${userId}:${selectedId}`} conversationId={selectedId} userId={userId} admin={admin} />
        </> : <p className="chat-hint">{selectedId ? "Открываем переписку…" : "Выберите переписку, чтобы прочитать сообщения и ответить."}</p>}
      </div>
    </div>}
  </section>;
}
