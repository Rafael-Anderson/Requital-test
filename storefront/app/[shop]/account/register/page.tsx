"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { useAuth } from "@/lib/auth";
import { sendPhoneOtp, verifyPhoneOtp } from "@/lib/api";
import { sanitizePhoneInput } from "@/lib/phone";
import { track } from "@/lib/analytics";
import { FIELD_CLASS, BUTTON_PRIMARY_CLASS, AUTH_CARD_CLASS, AUTH_HEADING_CLASS } from "@/lib/form-styles";
import StorefrontPageShell from "@/components/StorefrontPageShell";

const RESEND_SECONDS = 60;

export default function RegisterPage() {
  const router = useRouter();
  const { shopBasePath, shopSlug, shop } = useShop();
  const otpRequired = shop?.phoneOtpRequired === true;
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Phone code step (only when the shop asks for it).
  const [step, setStep] = useState<"details" | "code">("details");
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // A proof is single use but survives a rejected password, so it is kept for
  // the number it was issued for while the customer fixes their details.
  const [proof, setProof] = useState<{ phone: string; value: string } | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function requestCode() {
    setError(null);
    setNotice(null);
    try {
      await sendPhoneOtp(shopSlug, phone);
      setResendIn(RESEND_SECONDS);
      setNotice("If this number can receive codes, one is on its way.");
    } catch {
      setError("We could not send a code. Check your connection and try again.");
    }
  }

  async function finish(phoneProof?: string) {
    await register({ name, phone, email: email || undefined, password, phoneProof });
    track("sign_up", { method: "password" });
    router.push(`${shopBasePath}/account`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (otpRequired) {
        if (step === "details") {
          if (proof && proof.phone === phone) {
            await finish(proof.value);
          } else {
            await requestCode();
            setCode("");
            setStep("code");
          }
          return;
        }
        let verified: { proof: string };
        try {
          verified = await verifyPhoneOtp(shopSlug, phone, code);
        } catch {
          setError("That code did not work. Check it, or request a new one.");
          return;
        }
        setProof({ phone, value: verified.proof });
        try {
          await finish(verified.proof);
        } catch (err) {
          setStep("details");
          setError(err instanceof Error ? err.message : "Could not create your account");
        }
        return;
      }
      await finish();
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

      {otpRequired && step === "code" ? (
        <>
          <p className="text-sm text-zinc-500">
            Enter the 6 digit code we sent to {phone}.
          </p>
          <div>
            <label htmlFor="phone-code" className="text-sm font-medium block mb-1">
              Verification code
            </label>
            <input
              id="phone-code"
              required
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className={FIELD_CLASS}
            />
          </div>
          {notice && <p className="text-sm text-zinc-500">{notice}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <button
              type="button"
              disabled={resendIn > 0}
              onClick={() => void requestCode()}
              className="text-accent-text hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {resendIn > 0 ? `Send a new code in ${resendIn}s` : "Send a new code"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("details");
                setError(null);
              }}
              className="text-accent-text hover:underline"
            >
              Change details
            </button>
          </div>
        </>
      ) : (
      <>
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

      </>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" disabled={submitting} className={`w-full ${BUTTON_PRIMARY_CLASS}`}>
        {submitting
          ? "Please wait…"
          : otpRequired
            ? step === "code"
              ? "Verify and create account"
              : "Send verification code"
            : "Create account"}
      </button>

      <p className="text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href={`${shopBasePath}/account/login`} className="text-accent-text hover:underline">
          Sign in
        </Link>
      </p>
      </form>
    </StorefrontPageShell>
  );
}
