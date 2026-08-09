"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import Button from "@/components/ui/Button";
import * as api from "@/lib/api";

// Per-session, not permanent: sessionStorage clears on tab close, so a
// dismissed banner reappears next visit rather than being silently
// forgotten forever. The conservative enforcement point this backs is
// shop.published (see ShopService.getPublishReadiness) — an unverified
// account can otherwise use the whole admin panel freely; this is just a
// reminder, not a second gate.
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
        Verify your email address. You won&apos;t be able to publish your shop until you do.
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="secondary" size="sm" loading={sending} onClick={resend}>
          Resend email
        </Button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="text-amber-600 dark:text-amber-400 hover:opacity-70"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
