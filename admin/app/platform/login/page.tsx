"use client";

import { useState, type FormEvent } from "react";
import { usePlatformAuth } from "@/lib/platform-auth-context";
import { PlatformApiError } from "@/lib/platform-api";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";

export default function PlatformLoginPage() {
  const { login, completeMfa } = usePlatformAuth();
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      const status = err instanceof PlatformApiError ? err.status : undefined;
      const apiCode = err instanceof PlatformApiError ? err.code : undefined;
      if (mfaToken && status === 401 && apiCode !== "mfa_invalid") {
        // pending token expired: start again
        setMfaToken(null);
        setCode("");
      }
      setError(
        status === 429
          ? apiCode === "mfa_locked" && err instanceof Error
            ? err.message
            : "Too many attempts. Please wait a moment."
          : mfaToken
            ? apiCode === "mfa_invalid"
              ? "That code is not valid."
              : "Your sign-in expired. Start again."
            : "Incorrect email or password.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-8">
        <div className="mb-6 text-center">
          <div className="text-sm font-extrabold tracking-wide text-amber-400">
            REQUITAL · PLATFORM
          </div>
          <p className="mt-1 text-xs text-slate-400">Platform staff sign-in only</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {mfaToken ? (
            <>
              <Input
                label="Authentication code"
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="border-slate-700 bg-slate-950 text-slate-100"
              />
              <p className="text-xs text-slate-400">
                Enter the 6 digit code from your authenticator app, or a recovery code.
              </p>
            </>
          ) : (
            <>
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-slate-700 bg-slate-950 text-slate-100"
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border-slate-700 bg-slate-950 text-slate-100"
          />
            </>
          )}
          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-800 bg-red-950 px-3 py-2 text-[13px] text-red-300"
            >
              {error}
            </div>
          )}
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            className="w-full justify-center"
          >
            {mfaToken ? "Verify" : "Sign in"}
          </Button>
          {mfaToken && (
            <button
              type="button"
              className="w-full text-center text-xs text-slate-400 underline"
              onClick={() => {
                setMfaToken(null);
                setCode("");
                setError(null);
              }}
            >
              Back to sign in
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
