import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { imagePreview } from "../lib/image-preview";

type CatalogImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  preview?: boolean;
};

export function CatalogImage(props: CatalogImageProps) {
  // A different photo gets its own retry budget and cancels pending retries.
  return <RetryingImage key={props.src} {...props} />;
}

function RetryingImage({ src, preview = false, srcSet, sizes, alt, onError, onLoad, ...props }: CatalogImageProps) {
  // Image transformations require a compatible Storage plan; opt in explicitly.
  const previewSrc = preview && import.meta.env.VITE_SUPABASE_IMAGE_TRANSFORMS === "true" ? imagePreview(src, 640) : null;
  const [useOriginal, setUseOriginal] = useState(false);
  const [requestSrc, setRequestSrc] = useState(previewSrc ?? src);
  const responsiveSources = useOriginal ? undefined : srcSet ?? (previewSrc
    ? [160, 320, 640, 960].map(width => `${imagePreview(src, width)} ${width}w`).join(", ") : undefined);
  const [failed, setFailed] = useState(false);
  const attempts = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  if (failed) return <span className="image-fallback" role="img" aria-label={alt || "Изображение недоступно"}>Изображение недоступно</span>;

  return <img
    {...props}
    alt={alt}
    src={requestSrc}
    srcSet={responsiveSources}
    sizes={sizes ?? (previewSrc ? "(max-width: 760px) 50vw, (max-width: 1100px) 33vw, 360px" : undefined)}
    onLoad={(event) => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      onLoad?.(event);
    }}
    onError={(event) => {
      onError?.(event);
      if ((previewSrc || srcSet) && !useOriginal) {
        setUseOriginal(true);
        setRequestSrc(src);
        return;
      }
      if (timer.current !== null) return;
      if (attempts.current >= 2) { setFailed(true); return; }
      let url: URL;
      try { url = new URL(src, window.location.href); } catch { setFailed(true); return; }
      // Local previews cannot recover through another HTTP request.
      if (!['http:', 'https:'].includes(url.protocol)) { setFailed(true); return; }
      attempts.current += 1;
      const attempt = attempts.current;
      timer.current = setTimeout(() => {
        timer.current = null;
        // Request the complete object instead of reusing an interrupted response.
        url.searchParams.set("photo_retry", `${Date.now()}-${attempt}`);
        setRequestSrc(url.href);
      }, attempt * 1000);
    }}
  />;
}
