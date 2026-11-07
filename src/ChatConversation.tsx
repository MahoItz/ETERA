import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { ChatDeletedError, loadChatMessages, markChatRead, mergeMessages, notifyChatRead, refreshChat, sendChatMessage, type ChatMessage } from "./chat";
import { supabase } from "./supabase";
import { SelectionList } from "./SelectionList";

export function ChatConversation({ conversationId, workId, userId, admin = false, onLogin, blocked = false, onConversationCreated }: {
  conversationId?: string; workId?: string; userId: string | null; admin?: boolean; onLogin?: () => void; blocked?: boolean; onConversationCreated?: (id: string) => void;
}) {
  const [createdId, setCreatedId] = useState<string>();
  const id = conversationId ?? createdId;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(Boolean(id && userId));
  const [historyError, setHistoryError] = useState("");
  const [sendError, setSendError] = useState("");
  const [readError, setReadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [readRetry, setReadRetry] = useState(0);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const visibleNow = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  const latest = useRef(0);
  const acknowledged = useRef(0);
  const acknowledgementScope = useRef("");
  const pending = useRef(false);
  const request = useRef<{ id: string; body: string } | null>(null);
  const olderRequest = useRef<AbortController | null>(null);
  const fieldId = useId();
  const hasMessages = messages.length > 0;

  useEffect(() => {
    const element = log.current ?? root.current;
    if (!element) return;
    let intersecting = false;
    visibleNow.current = false;
    const update = () => { visibleNow.current = intersecting && !document.hidden; setVisible(visibleNow.current); };
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; update(); }, { threshold: 0.1 });
    observer.observe(element); document.addEventListener("visibilitychange", update);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, [hasMessages]);

  useEffect(() => {
    setMessages([]); latest.current = 0; acknowledged.current = 0; acknowledgementScope.current = `${userId}:${id}`;
    setHasOlder(false); setLoadingOlder(false); setHistoryError(""); setReadError(false); setAtBottom(true); setDeleted(false);
    if (!id || !userId) { setLoading(false); return; }
    setLoading(true);
    let stopped = false, running = false;
    const controller = new AbortController();
    const update = async () => {
      if (stopped || running || document.hidden) return;
      running = true;
      try {
        let batch: ChatMessage[];
        do {
          const after = latest.current;
          batch = await loadChatMessages(id, controller.signal, after ? { after } : {});
          if (stopped) return;
          if (!after) setHasOlder(batch.length === 50);
          latest.current = Math.max(latest.current, ...batch.map(message => message.seq));
          setMessages(previous => mergeMessages(previous, batch));
          // Drain a backlog without losing messages when more than 50 arrive.
          if (!after) break;
        } while (batch.length === 50);
        setHistoryError("");
      } catch (error) {
        if (!stopped) {
          if (error instanceof ChatDeletedError) { setMessages([]); setDeleted(true); setLoading(false); setHistoryError(""); stopped = true; }
          else setHistoryError(error instanceof Error ? error.message : "Не удалось загрузить переписку.");
        }
      } finally { running = false; if (!stopped) setLoading(false); }
    };
    void update();
    const interval = window.setInterval(() => void update(), 7000);
    window.addEventListener("focus", update); document.addEventListener("visibilitychange", update);
    const channel = supabase.channel(`chat-thread-${id}-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `conversation_id=eq.${id}` }, () => void update())
      .subscribe(status => { if (status === "SUBSCRIBED") void update(); });
    return () => {
      stopped = true; controller.abort(); olderRequest.current?.abort(); window.clearInterval(interval);
      window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); void supabase.removeChannel(channel);
    };
  }, [id, userId, retry]);

  useEffect(() => { if (atBottom && log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, atBottom]);
  useEffect(() => {
    const seq = Math.min(messages.at(-1)?.seq ?? 0, latest.current);
    if (!id || !userId || !visible || !visibleNow.current || !atBottom || seq <= acknowledged.current) return;
    const previous = acknowledged.current;
    const scope = `${userId}:${id}`;
    acknowledged.current = seq;
    void markChatRead(id, seq).then(() => { if (acknowledgementScope.current === scope) setReadError(false); notifyChatRead(id, userId); }).catch(() => {
      if (acknowledgementScope.current === scope && acknowledged.current === seq) { acknowledged.current = previous; setReadError(true); }
    });
  }, [messages, id, userId, visible, atBottom, readRetry]);

  async function older() {
    if (!id || loadingOlder || !messages.length) return;
    const controller = new AbortController(); olderRequest.current = controller;
    setLoadingOlder(true);
    const oldHeight = log.current?.scrollHeight ?? 0;
    const oldTop = log.current?.scrollTop ?? 0;
    try {
      const batch = await loadChatMessages(id, controller.signal, { before: messages[0].seq });
      if (controller.signal.aborted) return;
      setAtBottom(false); setMessages(previous => mergeMessages(previous, batch)); setHasOlder(batch.length === 50);
      requestAnimationFrame(() => { if (log.current) log.current.scrollTop = oldTop + log.current.scrollHeight - oldHeight; });
    } catch (error) { if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : "Не удалось загрузить сообщения."); }
    finally { if (!controller.signal.aborted) setLoadingOlder(false); }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || pending.current || blocked || deleted) return;
    if (!userId) { onLogin?.(); return; }
    const body = draft.trim();
    if (!request.current || request.current.body !== body) request.current = { id: crypto.randomUUID(), body };
    pending.current = true; setSending(true); setSendError(""); setSent(false);
    try {
      const result = await sendChatMessage(request.current.id, body, id, workId);
      setCreatedId(result.conversation_id); setMessages(previous => mergeMessages(previous, [result.message]));
      onConversationCreated?.(result.conversation_id);
      setAtBottom(true);
      setDraft(""); request.current = null; setSent(true); refreshChat();
    } catch (error) { setSendError(error instanceof Error ? error.message : "Не удалось отправить сообщение. Текст сохранён."); }
    finally { pending.current = false; setSending(false); }
  }

  return <div ref={root} className="chat-conversation">
    {deleted && <p className="chat-hint" role="status">Эта переписка удалена. Чтобы начать новую, закройте чат и снова нажмите «Написать мастеру» в карточке работы.</p>}
    {loading && <p className="chat-hint" role="status">Загружаем переписку…</p>}
    {historyError && <div className="chat-error"><p role="alert">{historyError}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Повторить загрузку</button></div>}
    {messages.length > 0 && <div ref={log} className="chat-log" role="log" aria-label="Переписка" tabIndex={0} onScroll={() => {
      const element = log.current;
      if (element) setAtBottom(element.scrollHeight - element.clientHeight - element.scrollTop < 35);
    }}>
      {hasOlder && <button type="button" className="chat-load-older" disabled={loadingOlder} onClick={() => void older()}>{loadingOlder ? "Загружаем…" : "Показать предыдущие сообщения"}</button>}
      {messages.map(message => <article key={message.id} className={"chat-message" + (message.sender_role === (admin ? "admin" : "customer") ? " is-own" : "")}>
        <span>{message.sender_role === (admin ? "admin" : "customer") ? "Вы" : admin ? "Покупатель" : "Мастер"}</span>
        <p>{message.body}</p>{message.selection && message.selection.length > 0 && <SelectionList items={message.selection} />}<time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
      </article>)}
    </div>}
    {readError && <p className="chat-hint">Не удалось отметить сообщения прочитанными. <button type="button" onClick={() => setReadRetry(value => value + 1)}>Повторить</button></p>}
    <form className="chat-composer" onSubmit={event => void send(event)}>
      <label htmlFor={fieldId}>{admin ? "Ответ покупателю" : "Сообщение мастеру"}</label>
      <textarea id={fieldId} value={draft} onChange={event => { setDraft(event.target.value); setSent(false); }} maxLength={4000} rows={4} disabled={sending} placeholder={admin ? "Напишите ответ…" : "Задайте вопрос о работе или расскажите, что хотите заказать…"} onKeyDown={event => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
      }} />
      {!userId && <p className="chat-hint">Для отправки войдите или зарегистрируйтесь. Набранный текст сохранится.</p>}
      {sendError && <p className="form-error" role="alert">{sendError} Текст сообщения сохранён.</p>}
      {sent && <p className="chat-success" role="status">Сообщение отправлено.</p>}
      <div className="chat-composer-footer"><small>{draft.length} / 4000</small><button type="submit" className="button primary" disabled={sending || loading || blocked || deleted || !draft.trim()}><Send size={15} />{sending ? "Отправляем…" : userId ? "Отправить" : "Войти и отправить"}</button></div>
    </form>
  </div>;
}
