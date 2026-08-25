"use client";

import { useState, type FormEvent } from "react";
import { usePlatformAuth } from "@/lib/platform-auth-context";
import { PlatformApiError } from "@/lib/platform-api";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";

export default function PlatformLoginPage() {
  const { login } = usePlatformAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      const status = err instanceof PlatformApiError ? err.status : undefined;
      setError(
        status === 429
          ? "Too many attempts. Please wait a moment."
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
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
