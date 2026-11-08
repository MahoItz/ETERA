import { useRef, useState, type FormEvent } from "react";
import { Check, Loader2 } from "lucide-react";
import { Modal } from "./EditorUI";
import { updatePassword } from "./catalog";
import type { PasswordRecoveryState } from "./usePasswordRecovery";

export function PasswordRecoveryEditor({ state, onClose, onRequestLink, onUpdated }: {
  state: PasswordRecoveryState;
  onClose: () => void;
  onRequestLink: () => void;
  onUpdated: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || state !== "ready" || saved) return;
    setError("");
    if (password !== confirmation) {
      setError("Пароли не совпадают. Проверьте повторный ввод.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      await updatePassword(password);
      setPassword(""); setConfirmation(""); setSaved(true);
      onUpdated();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось изменить пароль. Попробуйте ещё раз.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <Modal title={saved ? "Пароль изменён" : "Новый пароль"} onClose={() => { if (!busy) onClose(); }}>
    {state === "checking" ? <div className="editor-form" role="status" aria-busy="true">
      <p className="form-intro"><Loader2 size={16} className="spin" aria-hidden="true" /> Проверяем ссылку для восстановления…</p>
    </div> : saved ? <div className="editor-form">
      <p className="form-success" role="status"><Check size={16} aria-hidden="true" /> Пароль сохранён. Теперь вы можете входить в Elveria с новым паролем.</p>
      <div className="form-footer"><button type="button" className="button primary" onClick={onClose}>Вернуться в каталог</button></div>
    </div> : state === "invalid" ? <div className="editor-form">
      <p className="form-error" role="alert">Ссылка недействительна, устарела или уже использована. Запросите новое письмо для восстановления пароля.</p>
      <div className="form-footer"><button type="button" className="button primary" onClick={onRequestLink}>Получить новую ссылку</button></div>
    </div> : <form className="editor-form auth-form" onSubmit={submit}>
      <p className="form-intro">Придумайте новый пароль для вашего аккаунта. Используйте не менее 6 символов.</p>
      <label htmlFor="recovery-password">Новый пароль
        <input id="recovery-password" type="password" name="new-password" aria-label="Новый пароль" autoComplete="new-password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
      </label>
      <label htmlFor="recovery-password-confirmation">Повторите новый пароль
        <input id="recovery-password-confirmation" type="password" name="confirm-password" aria-label="Повторите новый пароль" autoComplete="new-password" minLength={6} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-footer">
        <button type="button" className="button secondary" disabled={busy} onClick={onClose}>Отмена</button>
        <button className="button primary" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить пароль"}</button>
      </div>
      {error && <button type="button" className="auth-switch" disabled={busy} onClick={onRequestLink}>Запросить новую ссылку</button>}
    </form>}
  </Modal>;
}
