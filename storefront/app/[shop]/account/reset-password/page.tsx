"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { resetCustomerPassword } from "@/lib/api";
import { FIELD_CLASS, BUTTON_PRIMARY_CLASS, AUTH_CARD_CLASS, AUTH_HEADING_CLASS } from "@/lib/form-styles";
import StorefrontPageShell from "@/components/StorefrontPageShell";

function ResetPasswordContent() {
  const router = useRouter();
  const { shopSlug } = useShop();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await resetCustomerPassword(shopSlug, token, newPassword);
      setDone(true);
      setTimeout(() => router.push(`/${shopSlug}/account/login`), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "This reset link is invalid or has expired");
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <StorefrontPageShell variant="narrow">
        <div className={AUTH_CARD_CLASS}>
          <p className="text-sm text-red-600">This reset link is missing its token.</p>
        </div>
      </StorefrontPageShell>
    );
  }

  if (done) {
    return (
      <StorefrontPageShell variant="narrow">
        <div className={AUTH_CARD_CLASS}>
          <p className="text-sm text-zinc-500">Password updated. Redirecting you to sign in…</p>
        </div>
      </StorefrontPageShell>
    );
  }

  return (
    <StorefrontPageShell variant="narrow">
      <form onSubmit={handleSubmit} className={AUTH_CARD_CLASS}>
        <h1 className={AUTH_HEADING_CLASS}>Choose a new password</h1>
        <div>
          <label className="text-sm font-medium block mb-1">New password</label>
          <input
            required
            type="password"
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={FIELD_CLASS}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={submitting} className={`w-full ${BUTTON_PRIMARY_CLASS}`}>
          {submitting ? "Saving…" : "Save new password"}
        </button>
      </form>
    </StorefrontPageShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
      <ResetPasswordContent />
    </Suspense>
  );
}
