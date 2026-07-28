import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002";

// The platform-wide sitemap (/sitemap.xml, see app/sitemap.xml/route.ts)
// only lists each shop's home URL — crawlers reach each shop's full
// per-shop sitemap (/<shop>/sitemap.xml) from there via that shop's own
// page, same as any other site-of-sites index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
