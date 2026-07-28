"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import AuthCard from "@/components/auth/AuthCard";
import { AUTH_INPUT_CLASS } from "@/components/auth/auth-input-class";

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const { acceptInvite } = useAuth();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("This invite link is missing its token — ask your admin to resend it");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setSubmitting(true);
    try {
      await acceptInvite({ token, password });
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invite");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard heading="Set your password" subtitle="Activate your staff account to get started">
      <div className="space-y-4">
        {!token ? (
          <p className="text-sm text-center text-red-600 dark:text-red-400">
            This invite link is invalid — ask your admin to send you a new one.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <Input
              label="Password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={AUTH_INPUT_CLASS}
            />
            <Input
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={AUTH_INPUT_CLASS}
            />
            <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
              {submitting ? "Activating…" : "Activate account"}
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

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}
