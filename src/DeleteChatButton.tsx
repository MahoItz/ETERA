import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "./EditorUI";
import { ChatChangedError, deleteChat, loadChatDeleteSnapshot, notifyChatDeleted } from "./chat";

export function DeleteChatButton({ id, title, userId, onDeleted, compact = false }: {
  id: string; title: string; userId: string; onDeleted?: (id: string) => void; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={compact ? "chat-delete-icon" : "chat-delete-action"} aria-label={compact ? `Удалить чат «${title}»` : "Удалить чат"} title="Удалить чат" onClick={() => setOpen(true)}>
      <Trash2 size={16} aria-hidden="true" />{!compact && "Удалить чат"}
    </button>
    {open && <DeleteChatConfirmation id={id} title={title} userId={userId} onClose={() => setOpen(false)} onDeleted={onDeleted} />}
  </>;
}

function DeleteChatConfirmation({ id, title, userId, onClose, onDeleted }: {
  id: string; title: string; userId: string; onClose: () => void; onDeleted?: (id: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const cancel = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  useEffect(() => { cancel.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setReady(false); setError("");
    loadChatDeleteSnapshot(id, controller.signal).then(result => {
      if (!controller.signal.aborted) { setSnapshot(result); setReady(true); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось проверить переписку.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, retry]);
  async function confirm() {
    if (!ready || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      await deleteChat(id, snapshot);
      onDeleted?.(id); notifyChatDeleted(id, userId); onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось удалить чат. Попробуйте ещё раз.");
      if (cause instanceof ChatChangedError) setReady(false);
    } finally { pending.current = false; setBusy(false); }
  }
  return <Modal title="Удалить чат?" onClose={() => { if (!busy) onClose(); }}>
    <div className="chat-delete-confirmation">
      <p>Переписка о работе «{title}», все сообщения и отметки о прочтении будут удалены <strong>у вас и собеседника</strong>. Отменить удаление нельзя.</p>
      {loading && <p className="chat-hint" role="status">Проверяем переписку…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!loading && !ready && error && <button type="button" className="chat-load-older" onClick={() => setRetry(value => value + 1)}>Проверить переписку заново</button>}
      <div className="form-footer">
        <button ref={cancel} type="button" className="button secondary" disabled={busy} onClick={onClose}>Отмена</button>
        <button type="button" className="button danger" disabled={!ready || loading || busy} onClick={() => void confirm()}>{busy ? "Удаляем…" : "Удалить переписку"}</button>
      </div>
    </div>
  </Modal>;
}
