"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getPolicyPage } from "@/lib/api";
import { sanitizeDescriptionHtml } from "@/lib/sanitize-html";
import { POLICY_PAGE_LABELS, type PolicyPageType } from "@/lib/types";
import StorefrontPageShell from "@/components/StorefrontPageShell";

// URL segment -> PolicyPageType — mirrors components/Footer.tsx's
// POLICY_URL_SLUGS by hand (the reverse direction of that same map).
const SLUG_TO_TYPE: Record<string, PolicyPageType> = {
  terms: "TERMS",
  privacy: "PRIVACY",
  refund: "REFUND",
  payment: "PAYMENT",
  shipping: "SHIPPING",
};

export default function PolicyPage() {
  const params = useParams<{ shop: string; type: string }>();
  const type = SLUG_TO_TYPE[params.type];

  const [content, setContent] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!type) {
      setNotFound(true);
      return;
    }
    getPolicyPage(params.shop, type)
      .then((page) => setContent(page.content))
      .catch(() => setNotFound(true));
  }, [params.shop, type]);

  if (notFound) {
    return (
      <StorefrontPageShell variant="narrow">
        <div className="text-center">
          <h1 className="text-xl font-semibold mb-2">Page not found</h1>
          <p className="text-sm text-zinc-500">This shop hasn&apos;t published this page yet.</p>
        </div>
      </StorefrontPageShell>
    );
  }

  if (content === null) {
    return (
      <StorefrontPageShell variant="medium">
        <p className="text-zinc-500">Loading…</p>
      </StorefrontPageShell>
    );
  }

  return (
    <StorefrontPageShell variant="medium">
      <h1 className="text-2xl font-bold mb-6">{POLICY_PAGE_LABELS[type]}</h1>
      {/* Same rendering treatment as ProductDetailClient's product.description
          — sanitized against the same fixed allowlist (see lib/sanitize-html.ts,
          which documents exactly what admin's RichTextEditor toolbar can
          produce) and the same manual arbitrary-variant styling, since this
          codebase has no Tailwind Typography plugin installed. */}
      <div
        className="text-[15px] text-zinc-600 leading-relaxed [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-product-name [&_h2]:mt-4 [&_h2]:mb-1.5 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-accent-text [&_a]:underline"
        dangerouslySetInnerHTML={{ __html: sanitizeDescriptionHtml(content) }}
      />
    </StorefrontPageShell>
  );
}
