import { CatalogImage } from "./CatalogImage";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, ChevronDown, Loader2, Plus, Star, Trash2, X } from "lucide-react";
import type { Photo, Variant, Work } from "../lib/model";
import { MAX_GALLERY_PHOTOS } from "../lib/model";
import { measurementsFromDraft, sizeDraft, type Measurements, type SizeDraft } from "../lib/measurements";
import { DimensionsEditor } from "./DimensionsEditor";
import { PhotoGalleryEditor } from "./PhotoGalleryEditor";
import { variantPhotos } from "../lib/variant-gallery";
import { deleteWork, renewUploadedPhoto, saveWork, uploadPhoto, loadDimensionSuggestions, deleteDimensionSuggestion, restoreDimensionSuggestion } from "./catalog";
import { WorkSaveSession } from "./work-save";
import { Modal, UnsavedChangesDialog, compressPhoto, imageUrl } from "./EditorUI";
import "./work-editor.css";

function EditableChoice({ label, value, options, onChange, disabled, required = false, maxLength }: {
  label: string; value: string; options: string[]; onChange: (value: string) => void;
  disabled: boolean; required?: boolean; maxLength: number;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [localOptions, setLocalOptions] = useState<string[]>([]);
  const details = useRef<HTMLDetailsElement>(null);
  const id = useId();
  const choices = [...new Set([...options, ...localOptions, value].filter(Boolean))];
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (details.current && event.target instanceof Node && !details.current.contains(event.target)) details.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  function add() {
    const clean = draft.trim();
    if (!clean) return;
    const existing = choices.find((option) => option.toLocaleLowerCase() === clean.toLocaleLowerCase());
    onChange(existing || clean);
    if (!existing) setLocalOptions((items) => [...items, clean]);
    setAdding(false);
    setDraft("");
  }
  return <div className="work-field">
    <span id={id}>{label}{required && " *"}</span>
    <details className="work-choice" ref={details} onKeyDown={(event) => {
      if (event.key === "Escape" && details.current) { event.preventDefault(); event.stopPropagation(); details.current.open = false; details.current.querySelector("summary")?.focus(); }
    }}>
      <summary aria-labelledby={id} aria-disabled={disabled} onClick={(event) => { if (disabled) event.preventDefault(); }}>
        <span>{value || "Выберите из списка"}</span><ChevronDown size={16} />
      </summary>
      <div className="sort-options work-choice-options" role="group" aria-labelledby={id}>
        {choices.map((option) => <button key={option} type="button" aria-pressed={value === option} disabled={disabled} onClick={() => {
          onChange(option); setAdding(false);
          if (details.current) { details.current.open = false; details.current.querySelector("summary")?.focus(); }
        }}><span>{option}</span><Check size={16} /></button>)}
        <button className="choice-add" type="button" disabled={disabled} onClick={() => {
          setAdding(true); setDraft(""); if (details.current) details.current.open = false;
        }}><Plus size={16} />Добавить {label === "Материал" ? "материал" : "категорию"}</button>
      </div>
    </details>
    {adding && <div className="choice-new">
      <input autoFocus aria-label={`Новый вариант: ${label}`} value={draft} maxLength={maxLength} disabled={disabled}
        placeholder={label === "Материал" ? "Например, керамика" : "Название категории"}
        onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); add(); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setAdding(false); }
        }} />
      <button type="button" className="icon-button" aria-label="Добавить вариант" disabled={disabled || !draft.trim()} onClick={add}><Check size={18} /></button>
      <button type="button" className="icon-button" aria-label="Отменить добавление" disabled={disabled} onClick={() => setAdding(false)}><X size={16} /></button>
    </div>}
  </div>;
}

export function WorkEditor({ work, categories, materials, onClose, onSaved, onDeleted }: {
  work: Work | null; categories: string[]; materials: string[];
  onClose: () => void; onSaved: (work: Work) => void;
  onDeleted: (work: Work) => Promise<void>;
}) {
  const [title, setTitle] = useState(work?.title || "");
  const [description, setDescription] = useState(work?.description || "");
  const [category, setCategory] = useState(work?.category || categories[0] || "");
  const [material, setMaterial] = useState(work?.material || materials[0] || "Гипс");
  const [dimensions, setDimensions] = useState(work?.dimensions || "");
  const [measurements, setMeasurements] = useState(() => sizeDraft(work?.measurements));
  const [variantSizes, setVariantSizes] = useState<Record<string, SizeDraft>>(() => Object.fromEntries(
    (work?.variants ?? []).map((variant) => [variant.id, sizeDraft(variant.measurements)]),
  ));
  const [dimensionSuggestions, setDimensionSuggestions] = useState<number[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [removedSuggestion, setRemovedSuggestion] = useState<number | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [price, setPrice] = useState(work?.price?.toString() || "");
  const [availability, setAvailability] = useState<Work["availability"]>(work?.availability || "order");
  const [status, setStatus] = useState<Work["status"]>(work?.status || "draft");
  const [featured, setFeatured] = useState(work?.featured || false);
  const [soldAsSet, setSoldAsSet] = useState(work?.soldAsSet ?? false);
  const [photos, setPhotos] = useState<Photo[]>(work?.photos || []);
  const [variants, setVariants] = useState<Variant[]>(() => (work?.variants ?? []).map(variant => ({ ...variant, photos: variantPhotos(variant) })));
  const [expandedVariants, setExpandedVariants] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const pending = useRef(new Map<string, { blob: Blob; uploaded?: Photo }>());
  const [saveSession] = useState(() => new WorkSaveSession(saveWork, work));
  const processing = useRef(false);
  const deleteErrorMessage = useRef<HTMLParagraphElement>(null);
  const formSnapshot = JSON.stringify({
    title, description, category, material, dimensions, measurements, variantSizes, price,
    availability, status, featured, soldAsSet, photos, variants,
  });
  const [initialFormSnapshot] = useState(() => formSnapshot);
  const dirty = formSnapshot !== initialFormSnapshot;
  let previewMeasurements: Measurements | null = null;
  try { previewMeasurements = measurementsFromDraft(measurements); } catch { /* Keep invalid input editable until save. */ }
  useEffect(() => {
    let active = true;
    loadDimensionSuggestions().then((values) => { if (active) setDimensionSuggestions(values); })
      .catch((error) => { if (active) setHistoryError(error instanceof Error ? error.message : "Не удалось загрузить прошлые размеры."); });
    return () => { active = false; };
  }, []);
  async function removeSuggestion(mm: number) {
    if (historyBusy) return;
    setHistoryBusy(true); setHistoryError("");
    try {
      await deleteDimensionSuggestion(mm);
      setDimensionSuggestions((values) => values.filter((value) => value !== mm));
      setRemovedSuggestion(mm);
    } catch (error) { setHistoryError(error instanceof Error ? error.message : "Не удалось удалить подсказку."); }
    finally { setHistoryBusy(false); }
  }
  async function undoRemoveSuggestion() {
    if (removedSuggestion === null || historyBusy) return;
    setHistoryBusy(true); setHistoryError("");
    try {
      await restoreDimensionSuggestion(removedSuggestion);
      setDimensionSuggestions((values) => [...new Set([...values, removedSuggestion])].sort((a, b) => a - b));
      setRemovedSuggestion(null);
    } catch (error) { setHistoryError(error instanceof Error ? error.message : "Не удалось вернуть подсказку."); }
    finally { setHistoryBusy(false); }
  }
  useEffect(() => {
    if (deleteError) deleteErrorMessage.current?.focus();
  }, [deleteError]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty, busy]);
  useEffect(() => {
    const staged = pending.current;
    return () => { for (const url of staged.keys()) URL.revokeObjectURL(url); staged.clear(); };
  }, []);
  function requestClose() {
    if (busy || processing.current) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }
  async function addPhotos(files: File[], variantId?: string) {
    if (!files.length || processing.current || busy) return;
    setError("");
    const gallery = variantId ? variants.find(variant => variant.id === variantId)?.photos ?? [] : photos;
    if (gallery.length + files.length > MAX_GALLERY_PHOTOS) { setError(`В эту галерею можно добавить ещё ${MAX_GALLERY_PHOTOS - gallery.length} фото. Всего — не больше ${MAX_GALLERY_PHOTOS}.`); return; }
    processing.current = true;
    setBusy(true);
    const failures: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        setProgress(`Подготавливаем фото ${index + 1} из ${files.length}`);
        try {
          const blob = await compressPhoto(file);
          const url = URL.createObjectURL(blob);
          pending.current.set(url, { blob });
          const photo = { url, alt: (variantId ? variants.find(variant => variant.id === variantId)?.name : title) || file.name };
          if (variantId) setVariants(items => items.map(variant => variant.id === variantId ? { ...variant, photos: [...(variant.photos ?? []), photo] } : variant));
          else setPhotos((items) => [...items, photo]);
        } catch (error) { failures.push(`${file.name}: ${error instanceof Error ? error.message : "Не удалось обработать фото"}`); }
      }
      if (failures.length) setError(failures.join("\n"));
    } finally { processing.current = false; setBusy(false); setProgress(""); }
  }
  function reorderPhoto(url: string, to: number, variantId?: string) {
    const reorder = (items: Photo[]) => {
      const from = items.findIndex((photo) => photo.url === url);
      if (from < 0 || to < 0 || to >= items.length) return items;
      const next = [...items]; next.splice(to, 0, ...next.splice(from, 1)); return next;
    };
    if (variantId) setVariants(items => items.map(variant => variant.id === variantId ? { ...variant, photos: reorder(variant.photos ?? []) } : variant));
    else setPhotos(reorder);
  }
  function removePhoto(url: string, variantId?: string) {
    // Pending URLs may still be referenced by another gallery. Release them on
    // editor unmount; persisted files are collected by the server after save.
    if (variantId) setVariants(items => items.map(variant => variant.id === variantId ? { ...variant, photos: (variant.photos ?? []).filter(photo => photo.url !== url) } : variant));
    else setPhotos((items) => items.filter((photo) => photo.url !== url));
  }
  function addVariant() {
    const id = crypto.randomUUID();
    setVariants((items) => [...items, {
      id, name: "", description: "", imageUrl: null, photos: [],
      price: null, availability: "available", position: items.length,
    }]);
    setExpandedVariants(ids => new Set([...ids, id]));
  }
  function updateVariant(id: string, changes: Partial<Variant>) {
    setVariants((items) => items.map((variant) => variant.id === id ? { ...variant, ...changes } : variant));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || processing.current) return;
    if (!title.trim()) { setError("Добавьте название работы."); return; }
    if (!category.trim()) { setError("Выберите или добавьте категорию."); return; }
    if (variants.some((variant) => !variant.name.trim())) {
      setExpandedVariants(ids => new Set([...ids, ...variants.filter(variant => !variant.name.trim()).map(variant => variant.id)]));
      setError("Добавьте название каждой отдельной фигурке."); return;
    }
    if (status === "published" && !photos.length) { setError("Добавьте хотя бы одно фото, чтобы показать работу в каталоге."); return; }
    if (status === "published" && variants.some(variant => !variant.photos?.length)) {
      const missing = variants.filter(variant => !variant.photos?.length);
      setExpandedVariants(ids => new Set([...ids, ...missing.map(variant => variant.id)]));
      setError(`Добавьте хотя бы одно собственное фото каждой фигурке: ${missing.map(variant => variant.name).join(", ")}.`);
      return;
    }
    let savedMeasurements: Measurements | null;
    const savedVariantSizes = new Map<string, Measurements | null>();
    try {
      savedMeasurements = measurementsFromDraft(measurements);
      for (const variant of variants) {
        try { savedVariantSizes.set(variant.id, measurementsFromDraft(variantSizes[variant.id] ?? sizeDraft(null))); }
        catch (error) { throw new Error(`${variant.name}: ${error instanceof Error ? error.message : "проверьте размеры"}`); }
      }
    } catch (error) { setError(error instanceof Error ? error.message : "Проверьте размеры."); return; }
    setBusy(true); setError(""); setProgress("Сохраняем работу");
    try {
      const photoUrlMap = new Map<string, string>();
      const allPhotos = [...photos, ...variants.flatMap(variant => variant.photos ?? [])];
      for (const photo of allPhotos) {
        if (photoUrlMap.has(photo.url)) continue;
        const staged = pending.current.get(photo.url);
        if (!staged) { photoUrlMap.set(photo.url, photo.url); continue; }
        if (staged.uploaded && !await renewUploadedPhoto(staged.uploaded.url)) staged.uploaded = undefined;
        if (!staged.uploaded) {
          setProgress(`Загружаем фото ${photoUrlMap.size + 1} из ${new Set(allPhotos.map(photo => photo.url)).size}`);
          const uploaded = await uploadPhoto(staged.blob);
          staged.uploaded = { url: uploaded.url, alt: photo.alt };
        }
        photoUrlMap.set(photo.url, staged.uploaded.url);
      }
      const resolvedPhotos = (gallery: Photo[]) => gallery.map(photo => ({ ...photo, url: photoUrlMap.get(photo.url) ?? photo.url }));
      const savedPhotos = resolvedPhotos(photos);
      const savedVariants = variants.map((variant, position) => ({
        ...variant,
        name: variant.name.trim(),
        imageUrl: variant.photos?.[0] ? photoUrlMap.get(variant.photos[0].url) ?? variant.photos[0].url : null,
        photos: resolvedPhotos(variant.photos ?? []),
        position,
        measurements: savedVariantSizes.get(variant.id) ?? null,
      }));
      setProgress("Сохраняем работу");
      onSaved(await saveSession.save({
        title, description, category, material, dimensions: savedMeasurements ? "" : dimensions,
        measurements: savedMeasurements, price: price.trim() ? Number(price) : null,
        availability: variants.length && !soldAsSet ? "available" : availability, status, featured, soldAsSet, photos: savedPhotos,
        variants: savedVariants,
        treeImage: work?.treeImage, showOnTree: work?.showOnTree,
      }));
    } catch (error) { setError(error instanceof Error ? error.message : "Не удалось сохранить работу. Попробуйте ещё раз."); }
    finally { setBusy(false); setProgress(""); }
  }
  async function remove() {
    if (!work || busy) return;
    setBusy(true); setDeleteError(""); setProgress("Удаляем работу");
    try {
      await deleteWork(work.id, work.revision);
      await onDeleted(work);
    } catch (error) {
      setDeleteError(error instanceof Error ? `Не удалось удалить работу. ${error.message}` : "Не удалось удалить работу. Попробуйте ещё раз.");
    } finally { setBusy(false); setProgress(""); }
  }

  return <>
    <Modal wide title={work ? "Редактировать работу" : "Новая работа"} onClose={requestClose}>
    <form className="editor-form work-editor" onSubmit={submit}>
      <p className="form-intro work-intro">Сначала добавьте основную работу и общие фотографии. Ниже можно добавить отдельные фигурки со своими фото и параметрами.</p>
      <div className="work-main-heading"><h3>Основная работа</h3><span>Общий вид, описание и категория</span></div>
      <div className="work-editor-layout">
        <div className="work-media-column">
        <PhotoGalleryEditor title="Общие фотографии" photos={photos} busy={busy}
          onAdd={files => addPhotos(files)} onRemove={url => removePhoto(url)} onReorder={(url, to) => reorderPhoto(url, to)} />
        {busy && <p className="work-progress" role="status"><Loader2 size={16} className="spin" />{progress}</p>}
        </div>

        <div className="work-details-panel">
          <section className="work-form-section" aria-labelledby="work-about-title">
            <div className="work-section-heading"><h3 id="work-about-title">О работе</h3><span>* обязательные поля</span></div>
            <label>Название *<input autoFocus required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Барашек с золотым бантом" disabled={busy} /></label>
            <label>Описание<textarea rows={3} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Расскажите о деталях, фактуре и настроении работы" disabled={busy} /></label>
            <div className="form-row">
              <EditableChoice label="Категория" required value={category} options={categories} onChange={setCategory} disabled={busy} maxLength={80} />
              <EditableChoice label="Материал" value={material} options={materials.length ? materials : ["Гипс"]} onChange={setMaterial} disabled={busy} maxLength={100} />
            </div>
          </section>
          <section className="work-form-section" aria-labelledby="work-detail-title">
            <div className="work-section-heading"><h3 id="work-detail-title">Детали и наличие</h3></div>
            {variants.length > 0 && <>
              <label className="checkbox work-featured"><input type="checkbox" checked={soldAsSet} onChange={event => setSoldAsSet(event.target.checked)} disabled={busy} /><span>Набор продаётся целиком</span></label>
              <p className="hint">{soldAsSet ? "Здесь укажите цену и размеры всего набора. У фигурок ниже — свои параметры." : "Это общий вид коллекции. Цена, наличие и размеры указываются отдельно у каждой фигурки."}</p>
            </>}
            {(!variants.length || soldAsSet) && <DimensionsEditor label={variants.length ? "Размеры всего набора" : "Размеры фигурки"} value={measurements} onChange={setMeasurements} suggestions={dimensionSuggestions}
              onDelete={removeSuggestion} disabled={busy || historyBusy} />}
            {historyError && <p className="form-error" role="alert">{historyError}</p>}
            {removedSuggestion !== null && <p className="dimension-history-message" role="status">
              Подсказка удалена. Размеры работ не изменились.
              <button type="button" disabled={busy || historyBusy} onClick={() => void undoRemoveSuggestion()}>Вернуть</button>
            </p>}
            {dimensions && !previewMeasurements && (!variants.length || soldAsSet) && <div className="size-legacy">
              Прежняя запись: <strong>{dimensions}</strong>. Уточните направления в полях выше, чтобы показать схему.
              <br /><button type="button" disabled={busy} onClick={() => setDimensions("")}>Удалить прежнюю запись</button>
            </div>}
            {(!variants.length || soldAsSet) && <div className="form-row">
              <label>{variants.length ? "Цена всего набора, ₽" : "Цена, ₽"}<input type="number" min={0} max={10000000} step="any" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="По запросу" disabled={busy} /></label>
            </div>}
            <div className="form-row">
              {(!variants.length || soldAsSet) && <label>Доступность<select value={availability} onChange={(event) => setAvailability(event.target.value as Work["availability"])} disabled={busy}><option value="available">В наличии</option><option value="order">Под заказ</option><option value="sold">Продано</option></select></label>}
              <label>Показ в каталоге<select value={status} onChange={(event) => setStatus(event.target.value as Work["status"])} disabled={busy}><option value="draft">Черновик</option><option value="published">В каталоге</option><option value="archived">Архив</option></select></label>
            </div>
            <label className="checkbox work-featured"><input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} disabled={busy} /><span>Закрепить в начале каталога</span><Star size={15} /></label>
            <p className="hint">{status === "draft" ? "Черновик виден только в редакторе. Дополните его и добавьте в каталог, когда всё будет готово." : status === "archived" ? "Архивная работа видна только в редакторе." : "Для показа в каталоге нужно хотя бы одно фото. Проданные работы видны только в редакторе."}</p>
          </section>
        </div>
      </div>
      <section className="variant-section" aria-labelledby="work-variants-title">
        <div className="work-section-heading">
          <div><h3 id="work-variants-title">Фигурки по отдельности</h3><span>{variants.length ? `${variants.length} добавлено` : "Необязательно: добавьте изделия для выбора поштучно"}</span></div>
        </div>
        <div className="variant-list">
          {variants.map((variant, index) => <details className="variant-editor" key={variant.id} open={expandedVariants.has(variant.id)}
            onToggle={event => {
              const open = event.currentTarget.open;
              setExpandedVariants(ids => {
                if (ids.has(variant.id) === open) return ids;
                const next = new Set(ids); if (open) next.add(variant.id); else next.delete(variant.id); return next;
              });
            }}>
            <summary className="variant-editor-summary">
              {variant.photos?.[0] ? <CatalogImage src={imageUrl(variant.photos[0].url)} alt="" /> : <span className="variant-summary-empty"><Plus size={20} /></span>}
              <span><strong>{variant.name || `Новая фигурка ${index + 1}`}</strong><small>{variant.price === null ? "Цена по запросу" : `${new Intl.NumberFormat("ru-RU").format(variant.price)} ₽ за штуку`} · {variant.photos?.length ?? 0} фото</small></span>
              <ChevronDown size={18} />
            </summary>
            <div className="variant-editor-body">
              <PhotoGalleryEditor title={`Фото: ${variant.name || `Фигурка ${index + 1}`}`} photos={variant.photos ?? []} compact busy={busy}
                onAdd={files => addPhotos(files, variant.id)} onRemove={url => removePhoto(url, variant.id)} onReorder={(url, to) => reorderPhoto(url, to, variant.id)} />
              <div className="variant-details">
                <label>Название фигурки *<input maxLength={120} value={variant.name} onChange={event => updateVariant(variant.id, { name: event.target.value })} placeholder="Например, Фея с золотыми крыльями" disabled={busy} /></label>
                <label>Описание фигурки<textarea rows={2} maxLength={4000} value={variant.description ?? ""} onChange={event => updateVariant(variant.id, { description: event.target.value })} placeholder="Особенности этой фигурки, если нужно" disabled={busy} /></label>
                <div className="variant-fields form-row">
                  <label>Цена за штуку, ₽<input type="number" min={0} max={10000000} step="any" value={variant.price ?? ""} onChange={event => updateVariant(variant.id, { price: event.target.value === "" ? null : Number(event.target.value) })} placeholder="По запросу" disabled={busy} /></label>
                  <label>Наличие фигурки<select value={variant.availability} onChange={event => updateVariant(variant.id, { availability: event.target.value as Variant["availability"] })} disabled={busy}><option value="available">В наличии</option><option value="order">Под заказ</option><option value="sold">Продано</option></select></label>
                </div>
                <DimensionsEditor label={`Размеры: ${variant.name || `Фигурка ${index + 1}`}`}
                  value={variantSizes[variant.id] ?? sizeDraft(null)} suggestions={dimensionSuggestions}
                  onChange={value => setVariantSizes(sizes => ({ ...sizes, [variant.id]: value }))}
                  onDelete={removeSuggestion} disabled={busy || historyBusy} />
                <p className="hint">Цена, размеры и фотографии относятся только к этой фигурке. Категория и материал — как у основной работы.</p>
                <button type="button" className="work-delete-button" disabled={busy} onClick={() => setVariants(items => items.filter(item => item.id !== variant.id))}><Trash2 size={15} />Удалить фигурку</button>
              </div>
            </div>
          </details>)}
        </div>
        <button type="button" className="button secondary variant-add variant-add-bottom" disabled={busy} onClick={addVariant}><Plus size={16} />Добавить отдельную фигурку</button>
      </section>
      {error && <p className="form-error work-form-error" role="alert">{error}</p>}
      <div className="form-footer work-editor-footer">
        {work && !confirmDelete && <button type="button" className="work-delete-button" disabled={busy} onClick={() => { setDeleteError(""); setConfirmDelete(true); }}><Trash2 size={16} />Удалить работу</button>}
        <span>{status === "draft" ? "Сохранится как черновик" : status === "published" ? "Будет показана в каталоге" : "Сохранится в архив"}</span>
        <button type="button" className="button secondary" disabled={busy} onClick={requestClose}>Отмена</button>
        <button className="button primary" disabled={busy}>{busy ? <><Loader2 size={16} className="spin" />{progress || "Сохраняем…"}</> : <><Check size={16} />{status === "draft" ? "Сохранить черновик" : "Сохранить работу"}</>}</button>
      </div>
    </form>
    </Modal>
    {confirmClose && <UnsavedChangesDialog onContinue={() => setConfirmClose(false)} onDiscard={onClose} />}
    {confirmDelete && work && <Modal title="Удалить работу?" onClose={() => { if (!busy) setConfirmDelete(false); }}>
      <div className="delete-dialog-body">
        <p>Работу «{work.title}», её фотографии и связанные фигурки нельзя будет восстановить.</p>
        {deleteError && <p ref={deleteErrorMessage} tabIndex={-1} className="form-error delete-dialog-error" role="alert">{deleteError}</p>}
        <div className="delete-dialog-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Отмена</button>
          <button type="button" className="button danger" disabled={busy} onClick={() => void remove()}><Trash2 size={16} />Удалить навсегда</button>
        </div>
      </div>
    </Modal>}
  </>;
}
