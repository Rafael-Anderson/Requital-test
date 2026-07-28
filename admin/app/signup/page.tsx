"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import AuthCard from "@/components/auth/AuthCard";
import { AUTH_INPUT_CLASS } from "@/components/auth/auth-input-class";

function slugifySubdomain(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function SignupPage() {
  const { signup } = useAuth();
  const [name, setName] = useState("");
  const [shopName, setShopName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [subdomainTouched, setSubdomainTouched] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleShopNameChange(value: string) {
    setShopName(value);
    if (!subdomainTouched) setSubdomain(slugifySubdomain(value));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // The signup page redirects to "/" the instant the session is set (see
      // RequireAuth), so there's no window to show a dev-only verification
      // link here — it's still logged server-side, and surfaced properly on
      // the profile menu's "Resend verification" action instead, which
      // doesn't navigate away.
      await signup({ name, email, password, shopName, subdomain });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create shop");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard heading="Create your shop" subtitle="You'll be the shop's admin account">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <Input
          label="Your name"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={AUTH_INPUT_CLASS}
        />
        <Input
          label="Shop name"
          required
          value={shopName}
          onChange={(e) => handleShopNameChange(e.target.value)}
          className={AUTH_INPUT_CLASS}
        />
        <Input
          label="Subdomain"
          required
          pattern="[a-z0-9-]+"
          value={subdomain}
          onChange={(e) => {
            setSubdomainTouched(true);
            setSubdomain(e.target.value);
          }}
          className={AUTH_INPUT_CLASS}
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={AUTH_INPUT_CLASS}
        />
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

        <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
          {submitting ? "Creating…" : "Create shop"}
        </Button>

        <p className="text-sm text-center text-zinc-500 dark:text-zinc-400">
          Already have a shop?{" "}
          <Link href="/login" className="underline decoration-transparent hover:decoration-current">
            Sign in
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
