"use client";

import EmailLinkAction from "@/components/EmailLinkAction";
import { confirmCampaignUnsubscribe, lookupCampaignUnsubscribe } from "@/lib/api";

// Target of the link in every campaign email. Opening it changes nothing; the
// button does (a mail scanner that prefetches the link cannot unsubscribe anyone).
export default function UnsubscribePage() {
  return (
    <EmailLinkAction
      heading="Unsubscribe"
      lookup={lookupCampaignUnsubscribe}
      act={confirmCampaignUnsubscribe}
      prompt={(shop) => `Stop receiving marketing emails from ${shop}?`}
      button="Unsubscribe"
      working="Unsubscribing..."
      done={(shop) => `You will no longer receive marketing emails from ${shop}.`}
    />
  );
}
