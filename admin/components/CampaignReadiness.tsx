"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import { getCampaignStatus } from "@/lib/api";
import type { CampaignStatusInfo } from "@/lib/types";

// The one place that says whether campaigns can be sent at all: the platform flag
// and the shop's verified sending domain. Shown above the list and the editor.
export default function CampaignReadiness({ onLoaded }: { onLoaded?: (s: CampaignStatusInfo) => void }) {
  const [status, setStatus] = useState<CampaignStatusInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getCampaignStatus()
      .then((s) => {
        if (!live) return;
        setStatus(s);
        onLoaded?.(s);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // onLoaded is only a notification.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) return <p role="alert" className="mb-4 text-sm text-red-600">Could not check whether campaigns are available.</p>;
  if (!status) return null;
  if (!status.enabled) {
    return (
      <Card className="mb-4">
        <p className="text-sm font-semibold text-text-primary dark:text-zinc-100">Email campaigns are not enabled for your shop yet</p>
        <p className="text-sm text-text-muted mt-1">Contact Requital to turn them on.</p>
      </Card>
    );
  }
  return (
    <Card className="mb-4 space-y-1">
      <p className="text-sm text-text-muted">
        Campaigns go only to customers who agreed to marketing emails and to confirmed newsletter subscribers. Anyone who
        unsubscribes is left out of every future campaign.
      </p>
      {status.sendingDomainVerified ? (
        <p className="text-sm text-text-muted">
          Sending from <span className="font-semibold text-text-primary dark:text-zinc-100">{status.fromAddress}</span>. Up to{" "}
          {status.dailyCap} campaign emails a day ({status.sentLast24Hours} in the last 24 hours).
        </p>
      ) : (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
          Campaigns are sent from your own verified domain.{" "}
          <Link href="/settings/business/sending-domain" className="underline">
            Verify a sending domain
          </Link>{" "}
          to send.
        </p>
      )}
    </Card>
  );
}
