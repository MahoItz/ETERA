export function imagePreview(src: string, width: number): string | null {
  let url: URL;
  try { url = new URL(src); } catch { return null; }
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
      !url.pathname.startsWith("/storage/v1/object/public/work-photos/works/")) return null;
  url.pathname = url.pathname.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
  url.searchParams.set("width", String(width));
  url.searchParams.set("quality", "75");
  url.searchParams.set("resize", "contain");
  return url.href;
}
