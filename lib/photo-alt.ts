// Older uploads may use an original file name or storage ID as their description.
const technicalAlt = /(?:\.(?:avif|gif|heic|heif|jpe?g|png|svg|webp)$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^(?:file|img|dsc|pxl)[_ -]?\d)/i;

export function photoAlt(alt: string | null | undefined, title: string): string {
  const description = alt?.trim() ?? "";
  return description && !technicalAlt.test(description) ? description : title.trim() || "Фото работы";
}
