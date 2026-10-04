import { notFound } from "next/navigation";
import { getShop, HttpError } from "@/lib/api";

// The storefront's pages are client components that fetch after hydration, so
// their own "not found" states can never change the HTTP status. A server
// layout calls this before it renders its children: when the probe answers a
// definite 404 for a PUBLISHED shop, it throws notFound() and the response
// leaves as a real 404 (ShopLayoutClient's Body must let the server render
// observe that, see SSR_STATUS_PARAMS there).
//
// Fails open on purpose: any other error (backend down, 5xx) leaves the page
// to its own client state. An unpublished shop is skipped because the theme
// builder previews its pages with a previewToken the server layout cannot see
// (layouts get no searchParams), so its product/collection reads 404 here.
// The probe is normally the same GET the layout or generateMetadata makes
// anyway, which Next dedupes within the render pass: no extra round trip.
export async function notFoundIfMissing(shopSlug: string, probe: () => Promise<unknown>): Promise<void> {
  const [shop, missing] = await Promise.all([
    getShop(shopSlug).catch(() => null),
    probe().then(
      () => false,
      (err: unknown) => err instanceof HttpError && err.status === 404,
    ),
  ]);
  if (missing && shop?.published) notFound();
}
