"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { verifyEmail } from "@/lib/api";
import AuthCard from "@/components/auth/AuthCard";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"pending" | "success" | "error">("pending");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("This verification link is missing its token.");
      return;
    }
    verifyEmail(token)
      .then(() => setStatus("success"))
      .catch((err) => {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Verification failed");
      });
  }, [token]);

  return (
    <AuthCard heading="Email verification">
      <div className="text-center space-y-4">
        {status === "pending" && <p className="text-text-muted dark:text-zinc-400">Verifying…</p>}
        {status === "success" && <p className="text-text-secondary dark:text-zinc-400">Your email is verified.</p>}
        {status === "error" && <p className="text-red-600 dark:text-red-400">{error}</p>}
        <Link href="/" className="inline-block text-accent hover:underline">
          Continue to Requital
        </Link>
      </div>
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}
