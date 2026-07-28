// Shared by both the per-shop (app/[shop]/sitemap.xml/route.ts) and
// platform-wide (app/sitemap.xml/route.ts) sitemap Route Handlers so the
// XML shape only lives in one place.
export function buildSitemapXml(urls: string[]): string {
  const entries = urls.map((loc) => `  <url><loc>${loc}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`;
}
