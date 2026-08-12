import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getProduct } from "@/lib/api";
import { isLocalHost } from "@/lib/is-local-host";
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
    // Mirrors proxy.ts's own isLocalHost check: on a hostname-resolved
    // request (subdomain/custom domain) the rewrite already stripped the
    // /<shop> prefix from the browser's own URL, so the redirect must stay
    // unprefixed too — but proxy.ts leaves local/CI requests (bare
    // localhost, matching e2e/urls.ts's STOREFRONT_URL) on the original
    // /<shop>/... path, where an unprefixed redirect would 404.
    const host = (await headers()).get("host") ?? "";
    const hostname = host.split(":")[0];
    const prefix = isLocalHost(hostname) ? `/${shopSlug}` : "";
    redirect(`${prefix}/products/${canonicalSlug}`);
  }

  return <ProductDetailClient />;
}
