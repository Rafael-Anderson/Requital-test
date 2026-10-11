"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { verifyCustomerEmail } from "@/lib/api";
import { BUTTON_PRIMARY_CLASS, AUTH_CARD_CLASS, AUTH_HEADING_CLASS } from "@/lib/form-styles";
import StorefrontPageShell from "@/components/StorefrontPageShell";

// The link in the email lands here and does nothing by itself: the address is only
// verified when the button is pressed, so a mail scanner that opens links cannot
// verify (or burn) a link.
function VerifyEmailContent() {
  const { shopSlug, shopBasePath } = useShop();
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleVerify() {
    setState("working");
    setError(null);
    try {
      await verifyCustomerEmail(shopSlug, token);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "This verification link is invalid or has expired");
      setState("idle");
    }
  }

  return (
    <StorefrontPageShell variant="narrow">
      <div className={`${AUTH_CARD_CLASS} space-y-3`}>
        <h1 className={AUTH_HEADING_CLASS}>Verify your email</h1>
        {!token ? (
          <p className="text-sm text-red-600">This verification link is missing its token.</p>
        ) : state === "done" ? (
          <>
            <p className="text-sm text-zinc-500">Your email address is verified. Password resets will be sent to it.</p>
            <Link href={`${shopBasePath}/account`} className="text-sm text-accent-text hover:underline">
              Go to my account
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-500">Confirm that this is your email address.</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="button"
              onClick={handleVerify}
              disabled={state === "working"}
              className={`w-full ${BUTTON_PRIMARY_CLASS}`}
            >
              {state === "working" ? "Verifying…" : "Verify email"}
            </button>
          </>
        )}
      </div>
    </StorefrontPageShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
