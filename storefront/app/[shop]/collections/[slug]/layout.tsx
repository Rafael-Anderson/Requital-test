import type { Metadata } from "next";
import { getCollectionBySlug, getShop } from "@/lib/api";
import { buildCollectionMetadata, canonicalUrlFor } from "@/lib/seo";
import { breadcrumbJsonLd } from "@/lib/structured-data";
import JsonLd from "@/components/JsonLd";

// Collection pages had no generateMetadata at all: every one of them
// inherited the shop-level title from [shop]/layout.tsx, so a shop's
// collections were indistinguishable in search results and none carried a
// canonical URL. Same Server-Component-wrapping-a-client-page split the PDP
// already uses (page.tsx is "use client" for the filter UI).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shop: string; slug: string }>;
}): Promise<Metadata> {
  const { shop: shopSlug, slug } = await params;
  try {
    const [collection, shop] = await Promise.all([
      getCollectionBySlug(shopSlug, slug),
      getShop(shopSlug),
    ]);
    return buildCollectionMetadata(shop, collection);
  } catch {
    // Unknown slug or unreachable shop - the page body renders its own empty
    // state; metadata falls back rather than failing the render.
    return { title: "Collection" };
  }
}

export default async function CollectionLayout({
  params,
  children,
}: {
  params: Promise<{ shop: string; slug: string }>;
  children: React.ReactNode;
}) {
  const { shop: shopSlug, slug } = await params;
  const breadcrumb = await collectionBreadcrumb(shopSlug, slug);
  return (
    <>
      {breadcrumb && <JsonLd data={breadcrumb} />}
      {children}
    </>
  );
}

// Home / collection, matching the trail the PDP's own breadcrumb uses for its
// middle step. Returns null on any failure - missing structured data is a
// non-event, a thrown layout is a blank page.
async function collectionBreadcrumb(shopSlug: string, slug: string) {
  try {
    const [collection, shop] = await Promise.all([
      getCollectionBySlug(shopSlug, slug),
      getShop(shopSlug),
    ]);
    const home = canonicalUrlFor(shop, "/");
    const url = canonicalUrlFor(shop, `/collections/${collection.slug}`);
    if (!home || !url) return null;
    return breadcrumbJsonLd([
      { name: "Home", url: home },
      { name: collection.name, url },
    ]);
  } catch {
    return null;
  }
}
