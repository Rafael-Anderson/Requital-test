import { notFound, redirect } from "next/navigation";
import { getProduct } from "@/lib/api";
import ProductDetailClient from "./ProductDetailClient";

// Next.js doesn't allow two dynamic segments at the same route depth
// ([id] and [slug] both under /[shop]/products/*) — "Ambiguous app routes".
// So this one segment carries both: a purely-numeric value is treated as a
// legacy id (old shared links), resolved and redirected to the canonical
// slug URL; anything else is rendered as the real slug.
export default async function ProductRoute({
  params,
}: {
  params: Promise<{ shop: string; slug: string }>;
}) {
  const { shop: shopSlug, slug } = await params;

  if (/^\d+$/.test(slug)) {
    // redirect() itself throws to short-circuit rendering, so it must not
    // be inside this try — only the lookup's own failure should 404.
    let canonicalSlug: string;
    try {
      canonicalSlug = (await getProduct(shopSlug, Number(slug))).slug;
    } catch {
      notFound();
    }
    redirect(`/${shopSlug}/products/${canonicalSlug}`);
  }

  return <ProductDetailClient />;
}
