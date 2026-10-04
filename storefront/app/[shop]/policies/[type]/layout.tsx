import { getPolicyPage, HttpError } from "@/lib/api";
import { POLICY_SLUG_TO_TYPE } from "@/lib/policy-slugs";
import { notFoundIfMissing } from "@/lib/not-found-gate";
import RenderWhenShopLoaded from "@/components/RenderWhenShopLoaded";

// Server layer for the status code only (the page is a client component). An
// unknown policy type, or a type this shop has not written, is a real 404.
export default async function PolicyLayout({
  params,
  children,
}: {
  params: Promise<{ shop: string; type: string }>;
  children: React.ReactNode;
}) {
  const { shop: shopSlug, type } = await params;
  const policyType = POLICY_SLUG_TO_TYPE[type];
  await notFoundIfMissing(shopSlug, async () => {
    if (!policyType) throw new HttpError("Unknown policy type", 404);
    await getPolicyPage(shopSlug, policyType);
  });
  return <RenderWhenShopLoaded>{children}</RenderWhenShopLoaded>;
}
