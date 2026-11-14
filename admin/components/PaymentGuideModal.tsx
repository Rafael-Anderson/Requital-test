"use client";

import { useState } from "react";
import { Copy, Info } from "lucide-react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { getPaymentGuide, NOMOD_WEBHOOK_EVENTS, type PaymentGuideId } from "@/lib/payment-guides";

// "How to get your keys": a secondary button that opens the shared Modal with a
// numbered, ordered-list guide for one payment method. Static content from
// lib/payment-guides.ts; the only live value is this shop's own webhook URL.
export default function PaymentGuideModal({
  guide,
  webhookUrl,
  buttonLabel = "How to get your keys",
}: {
  guide: PaymentGuideId;
  // null/undefined = not generated yet (Nomod); the step says where to get it.
  webhookUrl?: string | null;
  buttonLabel?: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const content = getPaymentGuide(guide);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast("Webhook URL copied");
    } catch {
      toast("Could not copy URL", "error");
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Info className="size-3.5" aria-hidden="true" />
        {buttonLabel}
      </Button>
      {open && (
        <Modal
          size="md"
          title={content.title}
          onClose={() => setOpen(false)}
          footer={(requestClose) => (
            <div className="flex justify-end">
              <Button type="button" variant="primary" onClick={requestClose}>
                Close
              </Button>
            </div>
          )}
        >
          <div dir="auto" className="space-y-3 text-sm text-text-secondary dark:text-zinc-300">
            {content.intro && <p>{content.intro}</p>}
            <ol className="list-decimal space-y-3 ps-5">
              {content.steps.map((step) => (
                <li key={step.text} className="ps-1">
                  <span>{step.text}</span>
                  {step.slot === "nomodEvents" && (
                    <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2" aria-label="Nomod webhook events">
                      {NOMOD_WEBHOOK_EVENTS.map((e) => (
                        <li key={e}>
                          <code className="text-xs">{e}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                  {step.slot === "webhookUrl" &&
                    (webhookUrl ? (
                      <div className="mt-2 flex items-center gap-2">
                        <code
                          dir="ltr"
                          title={webhookUrl}
                          className="min-w-0 flex-1 truncate text-xs bg-surface dark:bg-zinc-900 border border-border dark:border-white/10 rounded px-2 py-1.5"
                        >
                          {webhookUrl}
                        </code>
                        <button
                          type="button"
                          onClick={() => copy(webhookUrl)}
                          className="flex items-center gap-1 text-xs text-accent-text dark:text-accent hover:underline cursor-pointer shrink-0"
                        >
                          <Copy className="size-3" aria-hidden="true" />
                          Copy
                        </button>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-text-faint">
                        This shop&apos;s webhook address has not been generated yet. Press Generate webhook URL in the
                        box under the card form, then open this guide again.
                      </p>
                    ))}
                </li>
              ))}
            </ol>
            {content.notes.length > 0 && (
              <div className="rounded-lg border border-border dark:border-white/10 p-3 space-y-1">
                <p className="text-xs font-semibold text-text-primary dark:text-zinc-100">Good to know</p>
                <ul className="list-disc space-y-1 ps-4 text-xs text-text-faint">
                  {content.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
