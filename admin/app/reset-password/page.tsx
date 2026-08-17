"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { resetPassword } from "@/lib/api";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import AuthCard from "@/components/auth/AuthCard";
import { AUTH_INPUT_CLASS } from "@/components/auth/auth-input-class";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("This reset link is missing its token. Request a new one.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword({ token, newPassword });
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard heading="Set a new password">
      <div className="space-y-4">
        {done ? (
          <p className="text-sm text-center text-text-secondary dark:text-zinc-400">
            Password updated. Redirecting to sign in…
          </p>
        ) : !token ? (
          <p className="text-sm text-center text-red-600 dark:text-red-400">
            This reset link is invalid. Request a new one from the{" "}
            <Link href="/forgot-password" className="underline">
              forgot password
            </Link>{" "}
            page.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={AUTH_INPUT_CLASS}
            />
            <Input
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={AUTH_INPUT_CLASS}
            />
            <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
              {submitting ? "Saving…" : "Reset password"}
            </Button>
          </form>
        )}

        <p className="text-sm text-center text-text-muted dark:text-zinc-400">
          <Link href="/login" className="underline decoration-transparent hover:decoration-current">
            Back to sign in
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
