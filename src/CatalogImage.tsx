import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";

type CatalogImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet"> & {
  src: string;
};

export function CatalogImage(props: CatalogImageProps) {
  // A different photo gets its own retry budget and cancels pending retries.
  return <RetryingImage key={props.src} {...props} />;
}

function RetryingImage({ src, onError, onLoad, ...props }: CatalogImageProps) {
  const [requestSrc, setRequestSrc] = useState(src);
  const attempts = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  return <img
    {...props}
    src={requestSrc}
    onLoad={(event) => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      onLoad?.(event);
    }}
    onError={(event) => {
      onError?.(event);
      if (timer.current !== null || attempts.current >= 2) return;
      const url = new URL(src, window.location.href);
      // Local previews cannot recover through another HTTP request.
      if (!['http:', 'https:'].includes(url.protocol)) return;
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
