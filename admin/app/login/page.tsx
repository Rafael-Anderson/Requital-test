"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
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
    if (status === 401) return err instanceof ApiError && err.code === "mfa_invalid" ? "That code is not valid." : "Incorrect email or password.";
    if (status === 429) return err instanceof ApiError && err.code === "mfa_locked" ? err.message : "Too many attempts. Please wait a moment.";
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
  const { login, completeMfa } = useAuth();
  // Set once the password was right but a second factor is on: no session
  // exists yet, only this short-lived pending token.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
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
      if (mfaToken) {
        await completeMfa(mfaToken, code.trim());
      } else {
        const pending = await login(email, password);
        if (pending) setMfaToken(pending.mfaToken);
      }
    } catch (err) {
      // A pending token that expired (5 minutes) or went stale: start over.
      if (mfaToken && err instanceof ApiError && err.status === 401 && err.code !== "mfa_invalid") {
        setMfaToken(null);
        setCode("");
      }
      setError(describeLoginError(err));
      setShakeKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  function clearErrorOnChange() {
    if (error) setError(null);
  }

  if (mfaToken) {
    return (
      <AuthCard heading="Requital" subtitle="Two-factor authentication" hideWordmark>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div key={`code-${shakeKey}`} className={error ? "shake" : undefined}>
            <Input
              label="Authentication code"
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                clearErrorOnChange();
              }}
              aria-invalid={error ? true : undefined}
              className={`${AUTH_INPUT_CLASS} ${error ? ERROR_INPUT_CLASS : ""}`}
            />
            <p className="mt-1 text-xs text-text-muted">
              Enter the 6 digit code from your authenticator app, or one of your recovery codes.
            </p>
            {error && <InlineErrorMessage className="mt-2">{error}</InlineErrorMessage>}
          </div>
          <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
            {submitting ? "Verifying…" : "Verify"}
          </Button>
          <p className="text-sm text-center">
            <button
              type="button"
              className="underline text-text-muted"
              onClick={() => {
                setMfaToken(null);
                setCode("");
                setError(null);
              }}
            >
              Back to sign in
            </button>
          </p>
        </form>
      </AuthCard>
    );
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
          {error && <InlineErrorMessage className="mt-2">{error}</InlineErrorMessage>}
        </div>
        <p className="text-end -mt-2">
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
