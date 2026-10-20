import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, Maximize2 } from "lucide-react";
import type { Photo } from "../lib/model";
import { CatalogImage } from "./CatalogImage";
import { imageUrl } from "./EditorUI";

type ProductGalleryProps = {
  photos: Photo[];
  title: string;
  index: number;
  onSelect: (index: number) => void;
  onMove: (direction: 1 | -1) => void;
  onExpand: () => void;
  children?: ReactNode;
};

export function ProductGallery({ photos, title, index, onSelect, onMove, onExpand, children }: ProductGalleryProps) {
  const thumbnails = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const [frame, setFrame] = useState<{ cover: string; ratio: number } | null>(null);
  const photo = photos[index];
  const cover = photos[0]?.url;

  useEffect(() => {
    const strip = thumbnails.current;
    const active = strip?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (strip && active) {
      // Scroll just the thumbnail strip, keeping the product page in place.
      strip.scrollTo({ left: active.offsetLeft - strip.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2 });
    }
  }, [index, photos]);

  function startSwipe(event: PointerEvent<HTMLButtonElement>) {
    swiped.current = false;
    if (!event.isPrimary || event.button !== 0 || photos.length < 2) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function endSwipe(event: PointerEvent<HTMLButtonElement>) {
    const start = gesture.current;
    gesture.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      swiped.current = true;
      onMove(dx < 0 ? 1 : -1);
    }
  }

  return (
    <section className="product-gallery" aria-label="Фотографии изделия">
      <div className="product-gallery-stage" style={{ aspectRatio: frame?.cover === cover ? frame?.ratio : undefined }}>
        {photo ? (
          <button
            type="button"
            className="product-gallery-expand"
            aria-label="Открыть фото на весь экран"
            onClick={(event) => {
              const suppressClick = swiped.current && event.detail > 0;
              swiped.current = false;
              if (!suppressClick) onExpand();
            }}
            onPointerDown={startSwipe}
            onPointerUp={endSwipe}
            onPointerCancel={() => { gesture.current = null; }}
            onLostPointerCapture={() => { gesture.current = null; }}
          >
            <CatalogImage key={photo.url} src={imageUrl(photo.url)} alt={photo.alt || title} draggable={false} decoding="async"
              onLoad={(event) => {
                const image = event.currentTarget;
                const ratio = image.naturalWidth / image.naturalHeight;
                if (cover && Number.isFinite(ratio) && ratio > 0) {
                  // Match the first photo and keep the frame steady while browsing.
                  setFrame((current) => current?.cover === cover ? current : { cover, ratio });
                }
              }} />
            <span className="product-gallery-zoom" aria-hidden="true"><Maximize2 size={17} /></span>
          </button>
        ) : <div className="photo-placeholder"><ImagePlus size={30} /><span>Фотографии пока не добавлены</span></div>}
        {children}
        {photos.length > 1 && <>
          <button type="button" className="product-gallery-arrow product-gallery-prev" onClick={() => onMove(-1)} aria-label="Предыдущее фото"><ArrowLeft size={19} /></button>
          <button type="button" className="product-gallery-arrow product-gallery-next" onClick={() => onMove(1)} aria-label="Следующее фото"><ArrowRight size={19} /></button>
          <span className="product-gallery-count" role="status" aria-live="polite" aria-atomic="true"><span className="sr-only">Фото </span>{index + 1} / {photos.length}</span>
        </>}
      </div>
      {photos.length > 1 && <div ref={thumbnails} className="product-gallery-thumbnails" role="group" aria-label="Выбрать фотографию">
        {photos.map((item, photoIndex) => <button
          key={item.url + photoIndex}
          type="button"
          aria-label={`Фото ${photoIndex + 1}`}
          aria-pressed={index === photoIndex}
          onClick={() => onSelect(photoIndex)}
        ><CatalogImage src={imageUrl(item.url)} alt="" loading="lazy" draggable={false} /></button>)}
      </div>}
    </section>
  );
}
