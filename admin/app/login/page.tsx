"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import AuthCard from "@/components/auth/AuthCard";
import { AUTH_INPUT_CLASS } from "@/components/auth/auth-input-class";

const ERROR_INPUT_CLASS = "!border-2 !border-red-600 dark:!border-red-600";

// Prefers err.status (ApiError, see lib/api.ts's own comment on why status
// beats string-matching). When a status is present we trust it outright and
// never fall through to the substring checks: a 403 "invalid csrf token"
// (a stale session cookie blocking the login POST, see backend
// common/csrf.ts) was matching `includes("invalid")` and rendering as
// "Incorrect email or password.", making a CSRF failure impossible to tell
// apart from a genuine bad password. The substring matching is only a
// fallback for a non-ApiError rejection (a network-level Error with no
// status) that still happens to carry one of these words.
function describeLoginError(err: unknown): string {
  const status = err instanceof ApiError ? err.status : undefined;

  if (status !== undefined) {
    if (status === 401) return "Incorrect email or password.";
    if (status === 429) return "Too many attempts. Please wait a moment.";
    if (status === 423) return "Account locked. Please reset your password.";
    return "Something went wrong. Please try again.";
  }

  const message = err instanceof Error ? err.message.toLowerCase() : "";
  if (message.includes("invalid") || message.includes("incorrect")) {
    return "Incorrect email or password.";
  }
  if (message.includes("too many") || message.includes("rate")) {
    return "Too many attempts. Please wait a moment.";
  }
  if (message.includes("locked")) {
    return "Account locked. Please reset your password.";
  }
  return "Something went wrong. Please try again.";
}

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Bumped on every failed submit and used as each input wrapper's `key` —
  // changing an element's key forces React to remount it, which is what
  // makes the shake replay on a second (or third...) failed attempt even
  // though `error` itself doesn't change value between them.
  const [shakeKey, setShakeKey] = useState(0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(describeLoginError(err));
      setShakeKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  function clearErrorOnChange() {
    if (error) setError(null);
  }

  return (
    <AuthCard heading="Requital" subtitle="Sign in to your shop" hideWordmark>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div key={`email-${shakeKey}`} className={error ? "shake" : undefined}>
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearErrorOnChange();
            }}
            aria-invalid={error ? true : undefined}
            className={`${AUTH_INPUT_CLASS} ${error ? ERROR_INPUT_CLASS : ""}`}
          />
        </div>
        <div key={`password-${shakeKey}`} className={error ? "shake" : undefined}>
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearErrorOnChange();
            }}
            aria-invalid={error ? true : undefined}
            className={`${AUTH_INPUT_CLASS} ${error ? ERROR_INPUT_CLASS : ""}`}
          />
          {error && (
            <div
              role="alert"
              className="mt-2 rounded-md border border-red-400 bg-red-100 px-3 py-2 text-[13px] text-red-700 dark:border-red-500 dark:bg-red-950 dark:text-red-400"
            >
              {error}
            </div>
          )}
        </div>
        <p className="text-right -mt-2">
          <Link href="/forgot-password" className="text-sm text-accent hover:underline">
            Forgot password?
          </Link>
        </p>

        <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>

        <p className="text-sm text-center text-text-muted dark:text-zinc-400">
          New shop?{" "}
          <Link href="/signup" className="underline decoration-transparent hover:decoration-current">
            Create one
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
