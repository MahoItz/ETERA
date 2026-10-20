import { CatalogImage } from "./CatalogImage";
import { AdminModeIndicator } from "./AdminModeIndicator";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import type { Photo } from "../lib/model";
import { imageUrl, usePageScrollLock } from "./EditorUI";

type PhotoLightboxProps = {
  title: string;
  photos: Photo[];
  initialIndex: number;
  onClose: () => void;
  onPhotoChange?: (index: number) => void;
};

export function PhotoLightbox({ title, photos, initialIndex, onClose, onPhotoChange }: PhotoLightboxProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const thumbnails = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null);
  const [index, setIndex] = useState(() => Math.max(0, Math.min(initialIndex, photos.length - 1)));
  const photo = photos[index];

  usePageScrollLock();

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    thumbnails.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({
      block: "nearest",
      inline: "center",
    });
  }, [index]);

  useEffect(() => {
    onPhotoChange?.(index);
  }, [index, onPhotoChange]);

  function move(direction: -1 | 1) {
    setIndex((current) => (current + direction + photos.length) % photos.length);
  }

  function startSwipe(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary) {
      gesture.current = null;
      return;
    }
    if (event.button !== 0 || photos.length < 2) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function endSwipe(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    gesture.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      move(dx < 0 ? 1 : -1);
    }
  }

  return (
    <dialog
      ref={dialog}
      className={"photo-lightbox" + (photos.length === 1 ? " photo-lightbox-single" : "")}
      aria-label={`Фотографии: ${title}`}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          if (photos.length > 1) move(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <div className="photo-lightbox-header">
        <span className="photo-lightbox-title">{title}</span>
        <span className="photo-lightbox-count" role="status" aria-live="polite" aria-atomic="true">
          <span className="visually-hidden">Фото </span>{index + 1} / {photos.length}
        </span>
        <button type="button" className="photo-lightbox-control" onClick={onClose} aria-label="Закрыть просмотр фотографий" autoFocus>
          <X size={24} />
        </button>
      </div>
      <div
        className="photo-lightbox-stage"
        onPointerDown={startSwipe}
        onPointerUp={endSwipe}
        onPointerCancel={() => { gesture.current = null; }}
        onLostPointerCapture={() => { gesture.current = null; }}
      >
        {photo && <CatalogImage key={photo.url} src={imageUrl(photo.url)} alt={photo.alt || title} draggable={false} />}
      </div>
      {photos.length > 1 && (
        <>
          <button type="button" className="photo-lightbox-control photo-lightbox-prev" onClick={() => move(-1)} aria-label="Предыдущее фото">
            <ArrowLeft size={25} />
          </button>
          <button type="button" className="photo-lightbox-control photo-lightbox-next" onClick={() => move(1)} aria-label="Следующее фото">
            <ArrowRight size={25} />
          </button>
          <div ref={thumbnails} className="photo-lightbox-thumbnails" role="group" aria-label="Все фотографии товара">
            {photos.map((item, photoIndex) => (
              <button
                key={item.url + photoIndex}
                type="button"
                aria-label={`Показать фото ${photoIndex + 1}`}
                aria-pressed={photoIndex === index}
                onClick={() => setIndex(photoIndex)}
              >
                <CatalogImage src={imageUrl(item.url)} alt="" draggable={false} />
              </button>
            ))}
          </div>
        </>
      )}
      <AdminModeIndicator />
    </dialog>
  );
}
