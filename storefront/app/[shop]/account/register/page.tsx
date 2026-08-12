"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { sanitizePhoneInput } from "@/lib/phone";
import { FIELD_CLASS, BUTTON_PRIMARY_CLASS, AUTH_CARD_CLASS, AUTH_HEADING_CLASS } from "@/lib/form-styles";
import StorefrontPageShell from "@/components/StorefrontPageShell";

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register({ name, phone, email: email || undefined, password });
      router.push("/account");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your account");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <StorefrontPageShell variant="narrow">
      <form onSubmit={handleSubmit} className={AUTH_CARD_CLASS}>
      <h1 className={AUTH_HEADING_CLASS}>Create an account</h1>
      <p className="text-sm text-zinc-500">
        If you&apos;ve ordered from us before with this phone number, your past orders will show up here once you
        register.
      </p>

      <div>
        <label className="text-sm font-medium block mb-1">Name</label>
        <input required value={name} onChange={(e) => setName(e.target.value)} className={FIELD_CLASS} />
      </div>
      <div>
        <label className="text-sm font-medium block mb-1">Phone</label>
        <input
          required
          type="tel"
          inputMode="tel"
          maxLength={20}
          value={phone}
          onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))}
          className={FIELD_CLASS}
        />
      </div>
      <div>
        <label className="text-sm font-medium block mb-1">Email (optional)</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD_CLASS} />
        <p className="text-xs text-zinc-400 mt-1">Needed only if you want to be able to reset your password by email.</p>
      </div>
      <div>
        <label className="text-sm font-medium block mb-1">Password</label>
        <input
          required
          type="password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={FIELD_CLASS}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" disabled={submitting} className={`w-full ${BUTTON_PRIMARY_CLASS}`}>
        {submitting ? "Creating account…" : "Create account"}
      </button>

      <p className="text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href="/account/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
      </form>
    </StorefrontPageShell>
  );
}
