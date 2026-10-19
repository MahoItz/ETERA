import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

type PageScrollLock = {
  count: number;
  x: number;
  y: number;
  bodyCssText: string;
};

let pageScrollLock: PageScrollLock | null = null;

// A fixed body blocks touch scrolling as well as wheel scrolling behind a
// dialog. Keep this module-wide because dialogs may be nested (for example,
// the discard-confirmation dialog inside the work editor).
function lockPageScroll() {
  if (!pageScrollLock) {
    pageScrollLock = {
      count: 0,
      x: window.scrollX,
      y: window.scrollY,
      bodyCssText: document.body.style.cssText,
    };
    Object.assign(document.body.style, {
      position: "fixed",
      top: `-${pageScrollLock.y}px`,
      left: `-${pageScrollLock.x}px`,
      width: "100%",
      overflow: "hidden",
    });
  }
  pageScrollLock.count += 1;
  let released = false;
  return () => {
    if (released || !pageScrollLock) return;
    released = true;
    pageScrollLock.count -= 1;
    if (pageScrollLock.count > 0) return;
    const { x, y, bodyCssText } = pageScrollLock;
    document.body.style.cssText = bodyCssText;
    pageScrollLock = null;
    // The site's smooth anchor scrolling must not animate modal restoration.
    window.scrollTo({ left: x, top: y, behavior: "instant" });
  };
}

export function usePageScrollLock() {
  // Freeze and restore the background before the browser can paint a frame.
  useLayoutEffect(() => lockPageScroll(), []);
}

export const imageUrl = (url: string) =>
  /^https?:\/\//.test(url)
    ? url
    : new URL(
        url,
        `${window.location.origin}${import.meta.env.BASE_URL}`,
      ).toString();
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  usePageScrollLock();
  useLayoutEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={"modal " + (wide ? "wide" : "")}
      onCancel={(e) => {
        // File inputs also emit cancel when their native picker is dismissed.
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Закрыть">
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function UnsavedChangesDialog({
  onContinue,
  onDiscard,
  title = "Закрыть без сохранения?",
  message = "Есть несохранённые изменения. Если закрыть редактор, изменения полей и фотографий будут потеряны.",
  discardLabel = "Закрыть без сохранения",
}: {
  onContinue: () => void;
  onDiscard: () => void;
  title?: string;
  message?: string;
  discardLabel?: string;
}) {
  const keepEditing = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => keepEditing.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <Modal title={title} onClose={onContinue}>
      <div className="unsaved-changes-dialog" role="alert">
        <p>{message}</p>
        <div className="unsaved-changes-actions">
          <button ref={keepEditing} type="button" className="button secondary" onClick={onContinue}>Продолжить редактирование</button>
          <button type="button" className="button danger" onClick={onDiscard}>{discardLabel}</button>
        </div>
      </div>
    </Modal>
  );
}
export async function compressPhoto(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error(
      "Поддерживаются JPG, PNG и WebP. Фото HEIC сначала сохраните как JPG.",
    );
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Исходное фото должно быть меньше 20 МБ");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bitmap.width * scale);
    c.height = Math.round(bitmap.height * scale);
    const context = c.getContext("2d");
    if (!context) throw new Error("Браузер не смог обработать фото");
    context.drawImage(bitmap, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      c.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Ошибка обработки фото"))),
        "image/webp",
        0.82,
      ),
    );
    if (blob.type !== "image/webp")
      throw new Error("Браузер не поддерживает обработку WebP");
    if (blob.size > 1500000)
      throw new Error("Фотография слишком большая после сжатия");
    return blob;
  } finally {
    bitmap.close();
  }
}
