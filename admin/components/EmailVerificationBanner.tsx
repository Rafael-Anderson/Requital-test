"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import * as api from "@/lib/api";

// Per-session, not permanent: sessionStorage clears on tab close, so a
// dismissed banner reappears next visit rather than being silently
// forgotten forever.
//
// What it backs (STF-14, 2026-09-20): publishing the shop
// (ShopService.getPublishReadiness) plus the three actions behind
// VerifiedEmailGuard — connecting a payment gateway, inviting staff and
// connecting a custom domain. Everything else in the admin stays open on
// purpose, so this is still a reminder rather than the enforcement: each
// gated endpoint returns its own 403 naming the action, which the calling
// page surfaces at the point of the attempt.
const DISMISS_KEY = "requital_email_verify_banner_dismissed";

export default function EmailVerificationBanner() {
  const { user } = useAuth();
  const showToast = useToast();
  // This component always renders null until `user` loads (below), which
  // only happens post-mount via AuthProvider's own effect — so reading
  // sessionStorage in a lazy initializer here never runs during SSR and
  // never risks a hydration mismatch, unlike a page-level fetch-on-mount.
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1",
  );
  const [sending, setSending] = useState(false);

  if (!user || user.emailVerified || dismissed) return null;

  async function resend() {
    setSending(true);
    try {
      await api.resendVerification();
      showToast("Verification email sent. Check your inbox.", "success");
    } catch {
      showToast("Couldn't send the verification email. Try again shortly.", "error");
    } finally {
      setSending(false);
    }
  }

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-6 py-2.5 text-sm text-amber-800 dark:text-amber-300">
      <span>
        Verify your email address. Until you do, you can&apos;t publish your shop, connect a
        payment gateway, invite staff, or connect a custom domain.
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="secondary" size="sm" loading={sending} onClick={resend}>
          Resend email
        </Button>
        <Tooltip label="Hide this reminder for the rest of your session" align="end">
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismiss}
            className="text-amber-600 dark:text-amber-400 hover:opacity-70"
          >
            <X className="size-4" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
