"use client";

import EmailLinkAction from "@/components/EmailLinkAction";
import { confirmNewsletter, lookupNewsletterConfirm } from "@/lib/api";

// Double opt-in: the subscription counts only once this button is pressed.
export default function NewsletterConfirmPage() {
  return (
    <EmailLinkAction
      heading="Confirm your subscription"
      lookup={lookupNewsletterConfirm}
      act={confirmNewsletter}
      prompt={(shop) => `Confirm that you want to receive marketing emails from ${shop}. You can unsubscribe at any time.`}
      button="Confirm subscription"
      working="Confirming..."
      done={(shop) => `You are subscribed to marketing emails from ${shop}.`}
      alreadyDone={(shop) => `You are already subscribed to marketing emails from ${shop}.`}
    />
  );
}
