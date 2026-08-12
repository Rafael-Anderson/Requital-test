"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { useAuth } from "@/lib/auth";
import { FIELD_CLASS, BUTTON_PRIMARY_CLASS, AUTH_CARD_CLASS, AUTH_HEADING_CLASS } from "@/lib/form-styles";
import StorefrontPageShell from "@/components/StorefrontPageShell";

export default function LoginPage() {
  const router = useRouter();
  const { shopBasePath } = useShop();
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(identifier, password);
      router.push(`${shopBasePath}/account`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <StorefrontPageShell variant="narrow">
      <form onSubmit={handleSubmit} className={AUTH_CARD_CLASS}>
      <h1 className={AUTH_HEADING_CLASS}>Sign in</h1>

      <div>
        <label className="text-sm font-medium block mb-1">Phone or email</label>
        <input
          required
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className={FIELD_CLASS}
        />
      </div>
      <div>
        <label className="text-sm font-medium block mb-1">Password</label>
        <input
          required
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={FIELD_CLASS}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" disabled={submitting} className={`w-full ${BUTTON_PRIMARY_CLASS}`}>
        {submitting ? "Signing in…" : "Sign in"}
      </button>

      <div className="text-sm text-zinc-500 space-y-1">
        <p>
          <Link href={`${shopBasePath}/account/forgot-password`} className="text-accent hover:underline">
            Forgot your password?
          </Link>
        </p>
        <p>
          No account yet?{" "}
          <Link href={`${shopBasePath}/account/register`} className="text-accent hover:underline">
            Create one
          </Link>
        </p>
      </div>
      </form>
    </StorefrontPageShell>
  );
}
