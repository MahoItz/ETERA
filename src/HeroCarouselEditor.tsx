import { useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2 } from "lucide-react";
import type { Work } from "../lib/model";
import { CatalogImage } from "./CatalogImage";
import { imageUrl, Modal, UnsavedChangesDialog } from "./EditorUI";
import { heroItems, isHeroEligible } from "./hero-items";
import "./hero-carousel-editor.css";

export function HeroCarouselEditor({ works, selectedIds, onClose, onSave }: {
  works: Work[];
  selectedIds: string[] | null;
  onClose: () => void;
  onSave: (ids: string[] | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string[] | null>(() => selectedIds === null ? null : [...selectedIds]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const submitting = useRef(false);
  const byId = new Map(works.map((work) => [work.id, work]));
  const ids = draft ?? heroItems(works).map((work) => work.id);
  const selected = new Set(ids);
  const search = query.trim().toLocaleLowerCase("ru");
  const available = works.filter((work) => isHeroEligible(work) && !selected.has(work.id)
    && (!search || `${work.title} ${work.category}`.toLocaleLowerCase("ru").includes(search)));
  const dirty = JSON.stringify(draft) !== JSON.stringify(selectedIds);
  const unavailable = draft !== null && ids.some((id) => {
    const work = byId.get(id);
    return !work || !isHeroEligible(work);
  });

  function close() {
    if (submitting.current) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }
  function change(next: string[] | null) {
    if (submitting.current) return;
    setDraft(next);
    setError("");
  }
  function move(index: number, direction: number) {
    const next = [...ids];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    change(next);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !dirty || unavailable || ids.length > 10) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try { await onSave(draft); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить карусель. Попробуйте ещё раз."); }
    finally { submitting.current = false; setBusy(false); }
  }

  return <>
    <Modal title="Карточки в карусели" onClose={close} wide>
      <form className="editor-form hero-carousel-editor" onSubmit={submit} aria-busy={busy}>
        <p className="form-intro">Выберите до 10 работ из каталога и задайте порядок. Названия и фотографии обновляются вместе с работами.</p>
        <div className="hero-carousel-mode">
          <div><strong>{draft === null ? "Автоматический подбор" : "Ручной подбор"}</strong><p className="hint">{draft === null ? "Сначала избранные, затем новые работы. Изменение списка включит ручной подбор." : "Посетители увидят работы в этом порядке. Новые работы не добавляются автоматически."}</p></div>
          <button type="button" className="button secondary" disabled={busy} onClick={() => change(draft === null ? [...ids] : null)}>
            {draft === null ? "Выбрать вручную" : "Вернуть автоподбор"}
          </button>
        </div>
        <section aria-labelledby="carousel-selected-heading">
          <h3 id="carousel-selected-heading">В карусели <span className="hero-carousel-count" aria-live="polite">{ids.length} / 10</span></h3>
          {ids.length ? <ol className="hero-carousel-list">
            {ids.map((id, index) => {
              const work = byId.get(id);
              const eligible = work && isHeroEligible(work);
              const title = work?.title ?? "Работа больше недоступна";
              return <li key={id} className={eligible ? "" : "is-unavailable"}>
                <span className="hero-carousel-position" aria-hidden="true">{index + 1}</span>
                <div className="hero-carousel-thumb">{work?.photos[0]?.url ? <CatalogImage src={imageUrl(work.photos[0].url)} alt="" loading="lazy" /> : <ImagePlus size={22} aria-hidden="true" />}</div>
                <div className="hero-carousel-title"><strong>{title}</strong>{!eligible && <small>Не показывается: работа удалена, скрыта, продана или без фото. Удалите её из подборки.</small>}</div>
                <div className="hero-carousel-row-actions">
                  <button type="button" className="icon-button" disabled={busy || index === 0} aria-label={`Выше: ${title}`} onClick={() => move(index, -1)}><ArrowUp size={18} /></button>
                  <button type="button" className="icon-button" disabled={busy || index === ids.length - 1} aria-label={`Ниже: ${title}`} onClick={() => move(index, 1)}><ArrowDown size={18} /></button>
                  <button type="button" className="icon-button" disabled={busy} aria-label={`Убрать из карусели: ${title}`} onClick={() => change(ids.filter((item) => item !== id))}><Trash2 size={18} /></button>
                </div>
              </li>;
            })}
          </ol> : <p className="hero-carousel-empty hint">{draft === null ? "Пока нет подходящих работ." : "Карусель пуста. Добавьте работы ниже или верните автоподбор."}</p>}
        </section>
        <section aria-labelledby="carousel-available-heading">
          <h3 id="carousel-available-heading">Добавить из каталога</h3>
          <label htmlFor="carousel-work-search">Поиск по названию или категории<input id="carousel-work-search" type="search" value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} /></label>
          <p className="hint">Только опубликованные, непроданные работы с фотографией.{ids.length >= 10 ? " Достигнут лимит — уберите карточку, чтобы добавить другую." : ""}</p>
          {available.length ? <ul className="hero-carousel-list hero-carousel-available">
            {available.map((work) => <li key={work.id}>
              <div className="hero-carousel-thumb"><CatalogImage src={imageUrl(work.photos[0].url)} alt="" loading="lazy" /></div>
              <div className="hero-carousel-title"><strong>{work.title}</strong><small>{work.category}</small></div>
              <button type="button" className="icon-button" disabled={busy || ids.length >= 10} aria-label={`Добавить в карусель: ${work.title}`} onClick={() => change([...ids, work.id])}><Plus size={20} /></button>
            </li>)}
          </ul> : <p className="hero-carousel-empty hint">{search ? "По вашему запросу ничего не найдено." : "Все подходящие работы уже выбраны или пока отсутствуют в каталоге."}</p>}
        </section>
        {unavailable && <p className="form-error" role="alert">Перед сохранением удалите недоступные работы или верните автоподбор.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-footer">
          <button type="button" className="button secondary" disabled={busy} onClick={close}>Отмена</button>
          <button type="submit" className="button primary" disabled={busy || !dirty || unavailable || ids.length > 10}>{busy ? "Сохраняем…" : "Сохранить"}</button>
        </div>
      </form>
    </Modal>
    {confirmClose && <UnsavedChangesDialog message="Изменения состава и порядка карусели ещё не сохранены." onContinue={() => setConfirmClose(false)} onDiscard={onClose} />}
  </>;
}
