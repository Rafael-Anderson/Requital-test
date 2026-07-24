"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";

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
      await signup({ name, email, password, shopName, subdomain });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create shop");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <div className="text-center mb-2">
          <h1 className="text-2xl font-semibold">Create your shop</h1>
          <p className="text-sm text-zinc-500 mt-1">You&apos;ll be the shop&apos;s admin account</p>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <Input
          label="Your name"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="Shop name"
          required
          value={shopName}
          onChange={(e) => handleShopNameChange(e.target.value)}
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
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
          {submitting ? "Creating…" : "Create shop"}
        </Button>

        <p className="text-sm text-center text-zinc-500">
          Already have a shop?{" "}
          <Link href="/login" className="underline decoration-transparent hover:decoration-current">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
