import { NextResponse } from "next/server";
import { listShopsForSitemap } from "@/lib/api";
import { buildSitemapXml } from "@/lib/sitemap";

// A Route Handler (not the app/sitemap.ts metadata-file convention — see
// app/[shop]/sitemap.xml/route.ts's comment) at the platform root, listing
// every *published* shop's storefront home URL. Deliberately just
// {slug, updatedAt} per shop (see backend PublicService.listShopsForSitemap,
// which does the shop.published filtering — nothing to duplicate here)
// — nothing beyond what each shop's own public storefront URL already
// reveals to anyone who visits it.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002";

// Unlike /[shop]/sitemap.xml (dynamic automatically, since it has a route
// param), this route has none — Next would otherwise try to statically
// generate it at build time by actually calling the backend, which isn't
// running during `next build` and fails the whole build.
export const dynamic = "force-dynamic";

export async function GET() {
  const shops = await listShopsForSitemap();
  const urls = shops.map((s) => `${SITE_URL}/${s.slug}`);
  return new NextResponse(buildSitemapXml(urls), { headers: { "Content-Type": "application/xml" } });
}
