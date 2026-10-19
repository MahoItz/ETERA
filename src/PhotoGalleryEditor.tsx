import { useId, useRef, useState, type DragEvent } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, Plus, Star, X } from "lucide-react";
import { MAX_GALLERY_PHOTOS, type Photo } from "../lib/model";
import { CatalogImage } from "./CatalogImage";
import { imageUrl } from "./EditorUI";

export function PhotoGalleryEditor({ title, photos, busy, onAdd, onRemove, onReorder, compact = false }: {
  title: string; photos: Photo[]; busy: boolean; onAdd: (files: File[]) => Promise<void>;
  onRemove: (url: string) => void; onReorder: (url: string, to: number) => void; compact?: boolean;
}) {
  const id = useId(), input = useRef<HTMLInputElement>(null), dragDepth = useRef(0);
  const [active, setActive] = useState(photos[0]?.url ?? "");
  const [dragged, setDragged] = useState<string | null>(null), [dragOver, setDragOver] = useState(false);
  const chosen = photos.find(photo => photo.url === active) ?? photos[0];
  const index = chosen ? photos.indexOf(chosen) : -1;
  const desktopDrag = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const fileDrag = (event: DragEvent) => desktopDrag() && event.dataTransfer.types.includes("Files");
  return <section className={"work-photo-panel" + (compact ? " compact-gallery" : "")} aria-labelledby={id}
    onDragEnter={event => { if (fileDrag(event)) { event.preventDefault(); dragDepth.current++; if (!busy && photos.length < MAX_GALLERY_PHOTOS) setDragOver(true); } }}
    onDragOver={event => { if (fileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = busy || photos.length >= MAX_GALLERY_PHOTOS ? "none" : "copy"; } }}
    onDragLeave={event => { if (fileDrag(event)) { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragOver(false); } }}
    onDrop={event => { if (!fileDrag(event)) return; event.preventDefault(); dragDepth.current = 0; setDragOver(false); if (!busy) void onAdd(Array.from(event.dataTransfer.files)); }}>
    <div className="work-section-heading"><h3 id={id}>{title}</h3><span>{photos.length} / {MAX_GALLERY_PHOTOS}</span></div>
    <input ref={input} className="visually-hidden" tabIndex={-1} aria-label={`Загрузить фото: ${title}`} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || photos.length >= MAX_GALLERY_PHOTOS}
      onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void onAdd(files); }} />
    <div className={`work-photo-stage${dragOver ? " is-drag-over" : ""}${!chosen ? " is-empty" : ""}`}>
      {chosen ? <CatalogImage src={imageUrl(chosen.url)} alt={chosen.alt || title} /> : <div className="work-photo-empty">
        <span className="work-upload-icon"><ImagePlus size={28} /></span><strong>{compact ? "Свои фотографии фигурки" : "Общий вид работы или набора"}</strong>
        <span>До {MAX_GALLERY_PHOTOS} фото · первое станет обложкой</span>
        <button type="button" className="button secondary" disabled={busy} onClick={() => input.current?.click()}><Plus size={16} />Выбрать фотографии</button>
        <span className="desktop-drop-hint">или перетащите их сюда</span>
      </div>}
      {dragOver && <div className="work-drop-overlay"><ImagePlus size={28} /><strong>Отпустите, чтобы добавить фото</strong></div>}
    </div>
    {!!photos.length && <>
      <div className="work-photo-strip" aria-label={`Галерея: ${title}`}>
        {photos.map((photo, photoIndex) => <div key={photo.url} className={`work-photo-tile${chosen?.url === photo.url ? " selected" : ""}${dragged === photo.url ? " dragging" : ""}`}
          draggable={!busy} onDragStart={event => { if (!desktopDrag()) { event.preventDefault(); return; } setDragged(photo.url); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", photo.url); }}
          onDragEnd={() => setDragged(null)} onDragOver={event => { if (dragged && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
          onDrop={event => { if (dragged && !busy) { event.preventDefault(); event.stopPropagation(); onReorder(dragged, photoIndex); setDragged(null); } }}>
          <button type="button" className="work-photo-select" aria-label={`Посмотреть фото ${photoIndex + 1}${photoIndex === 0 ? ", обложка" : ""}`} aria-pressed={chosen?.url === photo.url} onClick={() => setActive(photo.url)}>
            <CatalogImage draggable={false} src={imageUrl(photo.url)} alt="" /><span className="work-photo-badge">{photoIndex === 0 ? "Обложка" : photoIndex + 1}</span>
          </button>
          <button type="button" className="work-photo-remove" disabled={busy} aria-label={`Удалить фото ${photoIndex + 1}`} onClick={() => onRemove(photo.url)}><X size={13} /></button>
        </div>)}
        {photos.length < MAX_GALLERY_PHOTOS && <button type="button" className="work-photo-more" disabled={busy} aria-label="Добавить фотографии" onClick={() => input.current?.click()}><Plus size={23} /><span>Ещё фото</span></button>}
      </div>
      <div className="work-photo-tools"><span>Фото {index + 1} из {photos.length}</span><div>
        <button type="button" className="icon-button" disabled={busy || index <= 0} aria-label="Переместить фото влево" onClick={() => onReorder(chosen.url, index - 1)}><ArrowLeft size={16} /></button>
        <button type="button" className="icon-button" disabled={busy || index >= photos.length - 1} aria-label="Переместить фото вправо" onClick={() => onReorder(chosen.url, index + 1)}><ArrowRight size={16} /></button>
        <button type="button" className="work-cover-button" disabled={busy || index <= 0} onClick={() => onReorder(chosen.url, 0)}><Star size={14} />{index === 0 ? "Обложка" : "На обложку"}</button>
      </div></div>
    </>}
    <p className="hint">JPG, PNG или WebP · до 20 МБ за фото.</p>
  </section>;
}
