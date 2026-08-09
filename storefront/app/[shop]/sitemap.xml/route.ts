import { NextResponse } from "next/server";
import { getShop, listCollections, listProducts } from "@/lib/api";
import { buildSitemapXml } from "@/lib/sitemap";

// A Route Handler (not the app/sitemap.ts metadata-file convention) since
// that convention only reliably scopes to a single top-level route in this
// Next.js version — this app is multi-tenant via a path-prefixed [shop]
// segment, so each shop needs its own detailed sitemap (home + collections +
// every product) at /<shop>/sitemap.xml. See app/sitemap.xml/route.ts for
// the platform-wide index (just shop home URLs) that links out to these.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002";

export async function GET(_request: Request, { params }: { params: Promise<{ shop: string }> }) {
  const { shop: shopSlug } = await params;
  const base = `${SITE_URL}/${shopSlug}`;

  try {
    const shop = await getShop(shopSlug);
    if (!shop.published) {
      return new NextResponse("Not found", { status: 404 });
    }
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const [collections, products] = await Promise.all([
    listCollections(shopSlug).catch(() => []),
    listProducts(shopSlug).catch(() => []),
  ]);

  const urls = [
    base,
    ...collections.map((c) => `${base}/collections/${c.slug}`),
    ...products.map((p) => `${base}/products/${p.slug}`),
  ];

  return new NextResponse(buildSitemapXml(urls), { headers: { "Content-Type": "application/xml" } });
}
