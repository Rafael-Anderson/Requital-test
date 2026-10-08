"use client";

import { useMemo } from "react";
import PageShell from "@/components/ui/PageShell";
import ActiveSessionsCard from "@/components/security/ActiveSessionsCard";
import PasswordCard from "@/components/security/PasswordCard";
import TwoFactorCard, { type TwoFactorAdapter } from "@/components/security/TwoFactorCard";
import ShopTwoFactorPolicyCard from "@/components/security/ShopTwoFactorPolicyCard";
import { useAuth } from "@/lib/auth-context";
import {
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  getTwoFactorStatus,
  regenerateRecoveryCodes,
  startTwoFactorEnrollment,
} from "@/lib/api";

// Settings > Security: the signed-in user's OWN account security (open to
// every staff role, unlike the rest of Settings; see the layout's exemption).
// Every call here is scoped to the caller server-side.
export default function SecurityPage() {
  const { user, refreshUser } = useAuth();
  const adapter = useMemo<TwoFactorAdapter>(
    () => ({
      getStatus: getTwoFactorStatus,
      start: startTwoFactorEnrollment,
      confirm: confirmTwoFactorEnrollment,
      disable: disableTwoFactor,
      regenerate: regenerateRecoveryCodes,
    }),
    [],
  );
  return (
    <PageShell>
      <div className="space-y-4">
        {user?.twoFactor?.enrollmentRequired && (
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Two-factor authentication is required on your account. Set it up below to keep using Requital.
          </div>
        )}
        <TwoFactorCard adapter={adapter} onChanged={() => void refreshUser()} />
        {user?.role === "admin" && <ShopTwoFactorPolicyCard ownEnabled={!!user.twoFactor?.enabled} />}
        <PasswordCard />
        <ActiveSessionsCard />
      </div>
    </PageShell>
  );
}
