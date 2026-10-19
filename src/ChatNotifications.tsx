import { useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import type { ChatInboxState } from "./useChatInbox";

export function ChatNotifications({ inbox, onOpen }: { inbox: ChatInboxState; onOpen: (id: string | null) => void }) {
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (root.current && event.target instanceof Node && !root.current.contains(event.target)) root.current.open = false; };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const open = (id: string | null) => { if (root.current) root.current.open = false; onOpen(id); };
  const notifications = [...inbox.threads].sort((a, b) => Number(b.unread_count > 0) - Number(a.unread_count > 0)).slice(0, 5);
  return <details className="chat-notifications" ref={root} onKeyDown={event => {
    if (event.key === "Escape" && root.current) { root.current.open = false; root.current.querySelector("summary")?.focus(); }
  }}>
    <summary aria-label={inbox.unread_count ? `Уведомления: ${inbox.unread_count} непрочитанных` : "Уведомления"} onClick={inbox.refresh}>
      <Bell size={19} aria-hidden="true" />{inbox.unread_count > 0 && <span className="chat-bell-count" aria-hidden="true">{inbox.unread_count > 99 ? "99+" : inbox.unread_count}</span>}
      {inbox.error && <span className="chat-notification-error" aria-label="Не удалось обновить уведомления">!</span>}
    </summary>
    <div className="chat-notification-panel">
      <strong>Уведомления</strong>
      {inbox.loading ? <p role="status">Загружаем…</p> : inbox.error ? <><p role="alert">{inbox.error}</p><button type="button" onClick={inbox.refresh}>Повторить загрузку</button></> : <>
        <p aria-live="polite">{inbox.unread_count ? `Непрочитанных сообщений: ${inbox.unread_count}` : "Нет непрочитанных сообщений"}</p>
        {notifications.map(thread => <button type="button" key={thread.id} onClick={() => open(thread.id)} className={thread.unread_count ? "is-unread" : ""}>
          <span>{thread.work_title}{thread.unread_count > 0 && <span className="chat-count">{thread.unread_count}</span>}</span><small>{thread.participant_label}</small><span className="chat-thread-preview">{thread.last_message}</span>
        </button>)}
      </>}
      <button type="button" className="chat-all-messages" onClick={() => open(null)}>Все сообщения</button>
    </div>
  </details>;
}
