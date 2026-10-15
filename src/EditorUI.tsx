import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

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
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={"modal " + (wide ? "wide" : "")}
      onCancel={(e) => {
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
