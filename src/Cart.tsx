import { useId, useRef, useState, type FormEvent } from "react";
import { MessageCircle, RefreshCw, ShoppingBag, Trash2 } from "lucide-react";
import { cartItemState, MAX_CART_ITEMS } from "../lib/cart";
import type { Work } from "../lib/model";
import type { CartState } from "./useCart";
import { submitCart } from "./cart-api";
import { refreshChat } from "./chat";
import { CatalogImage } from "./CatalogImage";
import { selectionMoney } from "./SelectionList";

export function Cart({ cart, works, onSent, onOpen }: { cart: CartState; works: Work[]; onSent: (id: string) => void; onOpen: (work: Work, variantId: string | null) => void }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const pending = useRef(false);
  const request = useRef<{ id: string; fingerprint: string } | null>(null);
  const fieldId = useId();
  const rows = cart.items.map(item => ({ item, ...cartItemState(item, works) }));
  const unavailable = rows.some(row => !row.available);

  async function remove(id: string) {
    setError("");
    try { await cart.remove(id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось удалить фигурку."); }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (pending.current || cart.busy || cart.loading || cart.error || unavailable || !rows.length) return;
    const ids = rows.map(row => row.item.id).sort();
    const body = comment.trim();
    const fingerprint = JSON.stringify([ids, body]);
    if (request.current?.fingerprint !== fingerprint) request.current = { id: crypto.randomUUID(), fingerprint };
    pending.current = true; setSending(true); setError("");
    try {
      const id = await submitCart(request.current.id, ids, body);
      request.current = null; refreshChat(); onSent(id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось отправить подборку."); cart.refresh(); }
    finally { pending.current = false; setSending(false); }
  }
  return <section className="cart" aria-label="Корзина">
    <div className="cart-heading"><div><h3>Корзина <small>{rows.length} / {MAX_CART_ITEMS}</small></h3><p>Соберите фигурки и отправьте подборку мастеру, чтобы обсудить детали.</p></div>
      <button type="button" className="icon-button" aria-label="Обновить корзину" onClick={cart.refresh} disabled={cart.loading || cart.busy || sending}><RefreshCw size={18} /></button></div>
    {cart.loading && <p role="status" className="form-intro">Обновляем корзину…</p>}
    {cart.error && <div className="chat-error"><p role="alert">{cart.error}</p><button type="button" onClick={cart.refresh}>Повторить загрузку</button></div>}
    {!cart.loading && !cart.error && !rows.length && <div className="cart-empty"><ShoppingBag size={30} /><p>В корзине пока нет фигурок. Добавьте понравившиеся из каталога.</p></div>}
    {rows.length > 0 && <>
      <ul className="cart-list">{rows.map(({ item, selection, available }) => <li key={item.id}>
        {selection.image_url && <CatalogImage src={selection.image_url} alt="" loading="lazy" />}
        <div className="cart-item-copy"><strong>{selection.variant_name || selection.title}</strong>
          {selection.variant_name && <small>{selection.title}</small>}{selection.sold_as_set && <small>Набор целиком</small>}
          <span>{selectionMoney(selection.price)}</span>
          {available ? <button type="button" className="cart-open" disabled={sending} onClick={() => {
            const work = works.find(work => work.id === selection.work_id); if (work) onOpen(work, selection.variant_id);
          }}>Посмотреть фигурку</button> : <small className="form-error">Больше недоступна. Удалите из подборки.</small>}
        </div>
        <button type="button" className="icon-button" aria-label={`Удалить «${selection.variant_name || selection.title}» из корзины`} disabled={cart.busy || sending} onClick={() => void remove(item.id)}><Trash2 size={18} /></button>
      </li>)}</ul>
      <form className="cart-form" onSubmit={event => void send(event)}>
        <label htmlFor={fieldId}><span>Комментарий мастеру <small>(необязательно)</small></span>
          <textarea id={fieldId} aria-label="Комментарий мастеру" value={comment} onChange={event => setComment(event.target.value)} maxLength={2000} rows={3} disabled={sending} placeholder="Расскажите о пожеланиях: цвет, количество, сроки…" />
        </label>
        <p className="form-intro">Мастер увидит подборку после отправки. Это обращение для обсуждения: фигурки не резервируются, цена и сроки согласовываются в переписке. Корзина сохранится.</p>
        <button className="button primary" type="submit" disabled={sending || cart.busy || cart.loading || Boolean(cart.error) || unavailable}><MessageCircle size={18} />{sending ? "Отправляем…" : "Обсудить с мастером"}</button>
      </form>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
