import { CatalogImage } from "./CatalogImage";
import { useEffect, useId, useRef, useState, type FormEvent, type DragEvent } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ImagePlus, Loader2, Plus, Star, Trash2, X } from "lucide-react";
import type { Photo, Variant, Work } from "../lib/model";
import { deleteWork, renewUploadedPhoto, saveWork, uploadPhoto } from "./catalog";
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
  const [price, setPrice] = useState(work?.price?.toString() || "");
  const [availability, setAvailability] = useState<Work["availability"]>(work?.availability || "order");
  const [status, setStatus] = useState<Work["status"]>(work?.status || "draft");
  const [featured, setFeatured] = useState(work?.featured || false);
  const [photos, setPhotos] = useState<Photo[]>(work?.photos || []);
  const [variants, setVariants] = useState<Variant[]>(work?.variants || []);
  const [activePhoto, setActivePhoto] = useState(work?.photos[0]?.url || "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [draggedPhoto, setDraggedPhoto] = useState<string | null>(null);
  const pending = useRef(new Map<string, { blob: Blob; uploaded?: Photo }>());
  const [saveSession] = useState(() => new WorkSaveSession(saveWork, work));
  const processing = useRef(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const chosenPhoto = photos.find((photo) => photo.url === activePhoto) || photos[0];
  const formSnapshot = JSON.stringify({
    title, description, category, material, dimensions, price,
    availability, status, featured, photos, variants,
  });
  const [initialFormSnapshot] = useState(() => formSnapshot);
  const dirty = formSnapshot !== initialFormSnapshot;
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
  function desktopDrag() { return window.matchMedia("(hover: hover) and (pointer: fine)").matches; }
  async function addPhotos(files: File[]) {
    if (!files.length || processing.current || busy) return;
    setError("");
    if (photos.length + files.length > 8) { setError(`Можно добавить ещё ${8 - photos.length} фото. Всего — не больше 8.`); return; }
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
          setPhotos((items) => [...items, { url, alt: title || file.name }]);
          setActivePhoto((current) => current || url);
        } catch (error) { failures.push(`${file.name}: ${error instanceof Error ? error.message : "Не удалось обработать фото"}`); }
      }
      if (failures.length) setError(failures.join("\n"));
    } finally { processing.current = false; setBusy(false); setProgress(""); }
  }
  function isFileDrag(event: DragEvent) { return desktopDrag() && event.dataTransfer.types.includes("Files"); }
  function reorderPhoto(url: string, to: number) {
    setPhotos((items) => {
      const from = items.findIndex((photo) => photo.url === url);
      if (from < 0 || to < 0 || to >= items.length) return items;
      const next = [...items]; next.splice(to, 0, ...next.splice(from, 1)); return next;
    });
  }
  function removePhoto(url: string) {
    if (pending.current.has(url)) { URL.revokeObjectURL(url); pending.current.delete(url); }
    setPhotos((items) => items.filter((photo) => photo.url !== url));
    if (activePhoto === url) setActivePhoto(photos.find((photo) => photo.url !== url)?.url || "");
  }
  function addVariant() {
    setVariants((items) => [...items, {
      id: crypto.randomUUID(), name: "", imageUrl: photos[0]?.url ?? null,
      price: null, availability: "available", position: items.length,
    }]);
  }
  function updateVariant(id: string, changes: Partial<Variant>) {
    setVariants((items) => items.map((variant) => variant.id === id ? { ...variant, ...changes } : variant));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || processing.current) return;
    if (!title.trim()) { setError("Добавьте название работы."); return; }
    if (!category.trim()) { setError("Выберите или добавьте категорию."); return; }
    if (variants.some((variant) => !variant.name.trim())) { setError("Добавьте название каждой отдельной фигурке."); return; }
    if (status === "published" && !photos.length) { setError("Добавьте хотя бы одно фото, чтобы показать работу в каталоге."); return; }
    setBusy(true); setError(""); setProgress("Сохраняем работу");
    try {
      const savedPhotos: Photo[] = [];
      const photoUrlMap = new Map<string, string>();
      for (const photo of photos) {
        const staged = pending.current.get(photo.url);
        if (!staged) { savedPhotos.push(photo); photoUrlMap.set(photo.url, photo.url); continue; }
        if (staged.uploaded && !await renewUploadedPhoto(staged.uploaded.url)) staged.uploaded = undefined;
        if (!staged.uploaded) {
          setProgress(`Загружаем фото ${savedPhotos.length + 1} из ${photos.length}`);
          const uploaded = await uploadPhoto(staged.blob);
          staged.uploaded = { url: uploaded.url, alt: photo.alt };
        }
        savedPhotos.push(staged.uploaded);
        photoUrlMap.set(photo.url, staged.uploaded.url);
      }
      const savedVariants = variants.map((variant, position) => ({
        ...variant,
        name: variant.name.trim(),
        imageUrl: variant.imageUrl ? photoUrlMap.get(variant.imageUrl) ?? savedPhotos[0]?.url ?? null : null,
        position,
      }));
      setProgress("Сохраняем работу");
      onSaved(await saveSession.save({
        title, description, category, material, dimensions, price: price.trim() ? Number(price) : null,
        availability, status, featured, photos: savedPhotos,
        variants: savedVariants,
        treeImage: work?.treeImage, showOnTree: work?.showOnTree,
      }));
    } catch (error) { setError(error instanceof Error ? error.message : "Не удалось сохранить работу. Попробуйте ещё раз."); }
    finally { setBusy(false); setProgress(""); }
  }
  async function remove() {
    if (!work || busy) return;
    setBusy(true); setError(""); setProgress("Удаляем работу");
    try {
      await deleteWork(work.id, work.revision);
      await onDeleted(work);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось удалить работу. Попробуйте ещё раз.");
    } finally { setBusy(false); setProgress(""); }
  }

  return <>
    <Modal wide title={work ? "Редактировать работу" : "Новая работа"} onClose={requestClose}>
    <form className="editor-form work-editor" onSubmit={submit}>
      <p className="form-intro work-intro">Сначала фотографии и название, затем детали. Незавершённую работу можно сохранить в черновики.</p>
      <div className="work-editor-layout">
        <div className="work-media-column">
        <section className="work-photo-panel" aria-labelledby="work-photos-title"
          onDragEnter={(event) => { if (isFileDrag(event)) { event.preventDefault(); dragDepth.current++; if (!busy && photos.length < 8) setDragOver(true); } }}
          onDragOver={(event) => { if (isFileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = busy || photos.length >= 8 ? "none" : "copy"; } }}
          onDragLeave={(event) => { if (isFileDrag(event)) { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragOver(false); } }}
          onDrop={(event) => {
            if (!isFileDrag(event)) return;
            event.preventDefault(); dragDepth.current = 0; setDragOver(false);
            void addPhotos(Array.from(event.dataTransfer.files));
          }}>
          <div className="work-section-heading"><h3 id="work-photos-title">Фотографии</h3><span>{photos.length} / 8</span></div>
          <input ref={uploadInput} className="visually-hidden" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || photos.length >= 8}
            onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; void addPhotos(files); }} />
          <div className={`work-photo-stage${dragOver ? " is-drag-over" : ""}${!chosenPhoto ? " is-empty" : ""}`}>
            {chosenPhoto ? <CatalogImage src={imageUrl(chosenPhoto.url)} alt={chosenPhoto.alt || title || "Фотография работы"} /> : <div className="work-photo-empty">
              <span className="work-upload-icon"><ImagePlus size={30} /></span><strong>Покажите работу во всей красе</strong>
              <span>Добавьте до 8 фотографий</span>
              <button type="button" className="button secondary" disabled={busy} onClick={() => uploadInput.current?.click()}><Plus size={16} />Выбрать фотографии</button>
              <span className="desktop-drop-hint">или перетащите их сюда</span>
            </div>}
            {dragOver && <div className="work-drop-overlay"><ImagePlus size={32} /><strong>Отпустите, чтобы добавить фото</strong></div>}
          </div>
          {!!photos.length && <>
            <div className="work-photo-strip" aria-label="Добавленные фотографии">
              {photos.map((photo, index) => <div className={`work-photo-tile${chosenPhoto?.url === photo.url ? " selected" : ""}${draggedPhoto === photo.url ? " dragging" : ""}`} key={photo.url}
                draggable={!busy} onDragStart={(event) => {
                  if (!desktopDrag()) { event.preventDefault(); return; }
                  setDraggedPhoto(photo.url); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", photo.url);
                }} onDragEnd={() => setDraggedPhoto(null)}
                onDragOver={(event) => { if (draggedPhoto && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
                onDrop={(event) => { if (draggedPhoto && !busy) { event.preventDefault(); event.stopPropagation(); reorderPhoto(draggedPhoto, index); setDraggedPhoto(null); } }}>
                <button type="button" className="work-photo-select" aria-label={`Посмотреть фото ${index + 1}${index === 0 ? ", обложка" : ""}`} aria-pressed={chosenPhoto?.url === photo.url} onClick={() => setActivePhoto(photo.url)}>
                  <CatalogImage draggable={false} src={imageUrl(photo.url)} alt="" /><span className="work-photo-badge">{index === 0 ? "Обложка" : index + 1}</span>
                </button>
                <button type="button" className="work-photo-remove" disabled={busy} aria-label={`Удалить фото ${index + 1}`} onClick={() => removePhoto(photo.url)}><X size={13} /></button>
              </div>)}
              {photos.length < 8 && <button type="button" className="work-photo-more" disabled={busy} aria-label="Добавить фотографии" onClick={() => uploadInput.current?.click()}><Plus size={23} /><span>Ещё фото</span></button>}
            </div>
            {chosenPhoto && <div className="work-photo-tools">
              <span>Фото {photos.indexOf(chosenPhoto) + 1} из {photos.length}</span>
              <div>
                <button type="button" className="icon-button" disabled={busy || photos.indexOf(chosenPhoto) === 0} aria-label="Переместить фото влево" onClick={() => reorderPhoto(chosenPhoto.url, photos.indexOf(chosenPhoto) - 1)}><ArrowLeft size={16} /></button>
                <button type="button" className="icon-button" disabled={busy || photos.indexOf(chosenPhoto) === photos.length - 1} aria-label="Переместить фото вправо" onClick={() => reorderPhoto(chosenPhoto.url, photos.indexOf(chosenPhoto) + 1)}><ArrowRight size={16} /></button>
                <button type="button" className="work-cover-button" disabled={busy || photos[0] === chosenPhoto} onClick={() => reorderPhoto(chosenPhoto.url, 0)}><Star size={14} />{photos[0] === chosenPhoto ? "Обложка" : "На обложку"}</button>
              </div>
            </div>}
          </>}
          <p className="hint">JPG, PNG или WebP · до 20 МБ за фото. Первое фото станет обложкой.<span className="desktop-drop-hint"> Порядок фото можно менять перетаскиванием.</span></p>
          {busy && <p className="work-progress" role="status"><Loader2 size={16} className="spin" />{progress}</p>}
        </section>
        <section className="variant-section" aria-labelledby="work-variants-title">
          <div className="work-section-heading">
            <div><h3 id="work-variants-title">Отдельные фигурки</h3><span>{variants.length ? `${variants.length} добавлено` : "Добавьте фигурки из этой коллекции"}</span></div>
            <button type="button" className="button secondary variant-add" disabled={busy} onClick={addVariant}><Plus size={15} />Добавить</button>
          </div>
          {!photos.length && <p className="hint">Сначала добавьте фотографии работы выше — они появятся здесь для выбора.</p>}
          <div className="variant-list">
            {variants.map((variant, index) => <div className="variant-editor" key={variant.id}>
              <div className="variant-editor-heading"><span>Фигурка {index + 1}</span><button type="button" className="icon-button" disabled={busy} aria-label={`Удалить фигурку ${index + 1}`} onClick={() => setVariants((items) => items.filter((item) => item.id !== variant.id))}><X size={15} /></button></div>
              <label>Название<input required maxLength={120} value={variant.name} onChange={(event) => updateVariant(variant.id, { name: event.target.value })} placeholder="Например, Фея с золотыми крыльями" disabled={busy} /></label>
              <div className="variant-fields form-row">
                <label>Цена, ₽<input type="number" min={0} max={10000000} step="any" value={variant.price ?? ""} onChange={(event) => updateVariant(variant.id, { price: event.target.value === "" ? null : Number(event.target.value) })} placeholder="По запросу" disabled={busy} /></label>
                <label>Доступность<select value={variant.availability} onChange={(event) => updateVariant(variant.id, { availability: event.target.value as Variant["availability"] })} disabled={busy}><option value="available">В наличии</option><option value="order">Под заказ</option><option value="sold">Продано</option></select></label>
              </div>
              {!!photos.length && <div className="variant-photo-picker" role="group" aria-label={`Фото фигурки ${index + 1}`}>
                <span>Фото фигурки</span>
                <div>{photos.map((photo, photoIndex) => <button type="button" key={photo.url} className={variant.imageUrl === photo.url ? "selected" : ""} aria-label={`Выбрать фото ${photoIndex + 1}`} aria-pressed={variant.imageUrl === photo.url} disabled={busy} onClick={() => updateVariant(variant.id, { imageUrl: photo.url })}><CatalogImage src={imageUrl(photo.url)} alt="" /><small>{photoIndex + 1}</small></button>)}</div>
              </div>}
            </div>)}
          </div>
          <button type="button" className="button secondary variant-add variant-add-bottom" disabled={busy} onClick={addVariant}><Plus size={15} />Добавить ещё фигурку</button>
        </section>
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
            <div className="form-row">
              <label>Размеры<input maxLength={150} value={dimensions} onChange={(event) => setDimensions(event.target.value)} placeholder="Например, 8 × 5 см" disabled={busy} /></label>
              <label>Цена, ₽<input type="number" min={0} max={10000000} step="any" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="По запросу" disabled={busy} /></label>
            </div>
            <div className="form-row">
              <label>Доступность<select value={availability} onChange={(event) => setAvailability(event.target.value as Work["availability"])} disabled={busy}><option value="available">В наличии</option><option value="order">Под заказ</option><option value="sold">Продано</option></select></label>
              <label>Показ в каталоге<select value={status} onChange={(event) => setStatus(event.target.value as Work["status"])} disabled={busy}><option value="draft">Черновик</option><option value="published">В каталоге</option><option value="archived">Архив</option></select></label>
            </div>
            <label className="checkbox work-featured"><input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} disabled={busy} /><span>Закрепить в начале каталога</span><Star size={15} /></label>
            <p className="hint">{status === "draft" ? "Черновик виден только в редакторе. Дополните его и добавьте в каталог, когда всё будет готово." : status === "archived" ? "Архивная работа видна только в редакторе." : "Для показа в каталоге нужно хотя бы одно фото. Проданные работы видны только в редакторе."}</p>
          </section>
        </div>
      </div>
      {error && <p className="form-error work-form-error" role="alert">{error}</p>}
      <div className="form-footer work-editor-footer">
        {work && !confirmDelete && <button type="button" className="work-delete-button" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={16} />Удалить работу</button>}
        <span>{status === "draft" ? "Сохранится как черновик" : status === "published" ? "Будет показана в каталоге" : "Сохранится в архив"}</span>
        <button type="button" className="button secondary" disabled={busy} onClick={requestClose}>Отмена</button>
        <button className="button primary" disabled={busy}>{busy ? <><Loader2 size={16} className="spin" />{progress || "Сохраняем…"}</> : <><Check size={16} />{status === "draft" ? "Сохранить черновик" : "Сохранить работу"}</>}</button>
      </div>
    </form>
    </Modal>
    {confirmClose && <UnsavedChangesDialog onContinue={() => setConfirmClose(false)} onDiscard={onClose} />}
    {confirmDelete && work && <Modal title="Удалить работу?" onClose={() => { if (!busy) setConfirmDelete(false); }}>
      <div className="delete-dialog-body" role="alert">
        <p>Работу «{work.title}», её фотографии и связанные фигурки нельзя будет восстановить.</p>
        <div className="delete-dialog-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Отмена</button>
          <button type="button" className="button danger" disabled={busy} onClick={() => void remove()}><Trash2 size={16} />Удалить навсегда</button>
        </div>
      </div>
    </Modal>}
  </>;
}
