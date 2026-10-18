import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";

type CatalogImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet"> & {
  src: string;
};

export function CatalogImage(props: CatalogImageProps) {
  // A different photo gets its own retry budget and cancels pending retries.
  return <RetryingImage key={props.src} {...props} />;
}

function RetryingImage({ src, alt, onError, onLoad, ...props }: CatalogImageProps) {
  const [requestSrc, setRequestSrc] = useState(src);
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
    onLoad={(event) => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      onLoad?.(event);
    }}
    onError={(event) => {
      onError?.(event);
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
