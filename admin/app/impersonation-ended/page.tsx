"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// Reached only via RequireAuth's own redirect when an impersonation
// session's access token expires (1h, non-refreshable — see
// lib/impersonation.ts) — never linked to directly. No merchant session
// exists at this point, by design, so this renders with none.
function ImpersonationEndedContent() {
  const searchParams = useSearchParams();
  const shopId = searchParams.get("shopId");
  const returnHref = shopId ? `/platform/shops/${shopId}` : "/platform/shops";

  return (
    <div className="mx-auto max-w-md pt-24 text-center">
      <div className="mb-4 inline-flex size-12 items-center justify-center rounded-full bg-amber-100 text-2xl dark:bg-amber-950">
        ⏱
      </div>
      <h1 className="mb-2 text-lg font-bold text-text-primary dark:text-zinc-100">
        Impersonation session expired
      </h1>
      <p className="mb-6 text-sm text-text-muted dark:text-zinc-400">
        The 1-hour impersonation session has ended. You were signed out of the merchant admin —
        this does not affect your platform admin session.
      </p>
      <Link
        href={returnHref}
        className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
      >
        Return to platform admin
      </Link>
    </div>
  );
}

// useSearchParams() (for the ?shopId= it reads) requires a Suspense
// boundary — same pattern app/orders/page.tsx already uses for its own
// ?orderId= deep link.
export default function ImpersonationEndedPage() {
  return (
    <Suspense fallback={null}>
      <ImpersonationEndedContent />
    </Suspense>
  );
}
