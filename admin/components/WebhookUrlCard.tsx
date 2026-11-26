"use client";

import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

// A webhook address the merchant COPIES OUT of Requital into the provider's own
// dashboard. Deliberately looks nothing like the credential inputs above it (an
// accent-tinted card with its own heading and a Copy button), because pasting this
// URL into a key field is exactly the mistake that silently broke a live shop's
// card payments.
export default function WebhookUrlCard({
  provider,
  url,
  children,
  actions,
  footer,
}: {
  provider: string;
  url: string | null;
  // Instructions shown above the URL.
  children: ReactNode;
  // Rendered instead of the URL row when there is no URL yet (a Generate button).
  actions?: ReactNode;
  // Extra controls under the URL (Nomod's "Generate a new webhook URL").
  footer?: ReactNode;
}) {
  const toast = useToast();

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast("Webhook URL copied");
    } catch {
      toast("Could not copy URL", "error");
    }
  }

  return (
    <Card className="space-y-2 border-accent/40 bg-accent/[0.04] dark:border-accent/40">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-text dark:text-accent">
          Copy out
        </span>
        <h3 className="text-[14px] font-bold text-text-primary dark:text-zinc-50">Copy to your {provider} dashboard</h3>
      </div>
      <div className="text-xs text-text-secondary dark:text-zinc-300">{children}</div>
      {url ? (
        <div className="flex items-center gap-2">
          <code
            title={url}
            className="min-w-0 flex-1 truncate rounded border border-border bg-surface px-2 py-1.5 text-xs dark:border-white/10 dark:bg-zinc-900"
          >
            {url}
          </code>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={copy}
            aria-label={`Copy ${provider} webhook URL`}
          >
            <Copy className="size-3.5" />
            Copy
          </Button>
        </div>
      ) : (
        actions
      )}
      {footer}
      <p className="text-xs text-text-faint">
        This is not a key. Never paste it into the API key or secret fields.
      </p>
    </Card>
  );
}
