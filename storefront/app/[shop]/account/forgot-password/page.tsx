"use client";

import { useState } from "react";
import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { forgotCustomerPassword } from "@/lib/api";
import { FIELD_CLASS, BUTTON_PRIMARY_CLASS, AUTH_CARD_CLASS, AUTH_HEADING_CLASS } from "@/lib/form-styles";
import StorefrontPageShell from "@/components/StorefrontPageShell";

export default function ForgotPasswordPage() {
  const { shopSlug } = useShop();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devResetLink, setDevResetLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await forgotCustomerPassword(shopSlug, email);
      setSent(true);
      setDevResetLink(res.devResetLink ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <StorefrontPageShell variant="narrow">
        <div className={`${AUTH_CARD_CLASS} space-y-3`}>
          <h1 className={AUTH_HEADING_CLASS}>Check your email</h1>
          <p className="text-sm text-zinc-500">
            If an account with that email exists, we&apos;ve sent a link to reset your password.
          </p>
          {devResetLink && (
            <p className="text-xs text-zinc-400 break-all">
              Dev mode — reset link:{" "}
              <Link href={devResetLink.replace(/^https?:\/\/[^/]+/, "")} className="text-accent hover:underline">
                {devResetLink}
              </Link>
            </p>
          )}
        </div>
      </StorefrontPageShell>
    );
  }

  return (
    <StorefrontPageShell variant="narrow">
      <form onSubmit={handleSubmit} className={AUTH_CARD_CLASS}>
        <h1 className={AUTH_HEADING_CLASS}>Reset your password</h1>
        <p className="text-sm text-zinc-500">
          Enter the email you registered with — only accounts registered with an email can reset their password this
          way.
        </p>
        <div>
          <label className="text-sm font-medium block mb-1">Email</label>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={FIELD_CLASS}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={submitting} className={`w-full ${BUTTON_PRIMARY_CLASS}`}>
          {submitting ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </StorefrontPageShell>
  );
}
