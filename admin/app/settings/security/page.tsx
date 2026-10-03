"use client";

import PageShell from "@/components/ui/PageShell";
import ActiveSessionsCard from "@/components/security/ActiveSessionsCard";
import PasswordCard from "@/components/security/PasswordCard";

// Settings > Security: the signed-in user's OWN account security (open to
// every staff role, unlike the rest of Settings; see the layout's exemption).
// Every call here is scoped to the caller server-side.
export default function SecurityPage() {
  return (
    <PageShell>
      <div className="space-y-4">
        <PasswordCard />
        <ActiveSessionsCard />
      </div>
    </PageShell>
  );
}
