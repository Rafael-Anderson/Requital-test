"use client";

import { useMemo } from "react";
import TwoFactorCard, { type TwoFactorAdapter } from "@/components/security/TwoFactorCard";
import {
  platformConfirmTwoFactor,
  platformDisableTwoFactor,
  platformRegenerateRecoveryCodes,
  platformStartTwoFactor,
  platformTwoFactorStatus,
} from "@/lib/platform-api";

// Platform tier twin of Settings > Security's two-factor card. Platform admins
// are CLI-seeded and have a single 12 hour session with no refresh token, so
// there is no session list here (nothing to list or revoke).
export default function PlatformSecurityPage() {
  const adapter = useMemo<TwoFactorAdapter>(
    () => ({
      getStatus: platformTwoFactorStatus,
      start: platformStartTwoFactor,
      confirm: platformConfirmTwoFactor,
      disable: platformDisableTwoFactor,
      regenerate: platformRegenerateRecoveryCodes,
    }),
    [],
  );
  return (
    <div className="mx-auto w-full space-y-4 text-slate-900 sm:w-2/3">
      <h1 className="text-xl font-extrabold text-slate-100">Security</h1>
      <TwoFactorCard adapter={adapter} subject="your platform account" />
    </div>
  );
}
