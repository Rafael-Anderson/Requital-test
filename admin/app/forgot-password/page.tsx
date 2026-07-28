"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { forgotPassword } from "@/lib/api";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import AuthCard from "@/components/auth/AuthCard";
import { AUTH_INPUT_CLASS } from "@/components/auth/auth-input-class";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  // DEV-ONLY: no real email-sending infrastructure exists yet — see
  // backend/src/common/email.ts. The link is only ever echoed back outside
  // NODE_ENV=production.
  const [devResetLink, setDevResetLink] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await forgotPassword(email);
      setSent(true);
      if (result.devResetLink) setDevResetLink(result.devResetLink);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard heading="Reset your password" subtitle="We'll email you a reset link">
      <div className="space-y-4">
        {sent ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              If an account exists for that email, a reset link is on its way.
            </p>
            {devResetLink && (
              <p className="text-xs text-zinc-400 dark:text-zinc-500 break-all">
                Dev-only (no email sending yet):{" "}
                <a href={devResetLink} className="text-accent hover:underline">
                  {devResetLink}
                </a>
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={AUTH_INPUT_CLASS}
            />
            <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
              {submitting ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}

        <p className="text-sm text-center text-zinc-500 dark:text-zinc-400">
          <Link href="/login" className="underline decoration-transparent hover:decoration-current">
            Back to sign in
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}
