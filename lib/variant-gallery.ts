import type { Photo, Variant } from "./model";

export function variantPhotos(variant: Variant): Photo[] {
  // Old save receipts and clients only have the single cover URL.
  return variant.photos ?? (variant.imageUrl ? [{ url: variant.imageUrl, alt: variant.name }] : []);
}
