"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy } from "lucide-react";
import {
  API_URL,
  getNomodPending,
  nomodRotateWebhookUrl,
  nomodTestConnection,
  nomodWebhookUrl,
  recheckNomodCheckout,
} from "@/lib/api";
import type { NomodPendingCheckout } from "@/lib/types";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

// Everything about Nomod that is not a credential field: the webhook address to
// paste into Nomod, a connection test, the partial refund warning and the list of
// payments that are still unconfirmed. Nothing here ever shows a key or a signing
// secret; the backend never returns one.
export default function NomodExtras({
  webhookPath,
  hasApiKey,
  onChanged,
}: {
  webhookPath: string | null | undefined;
  hasApiKey: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [path, setPath] = useState<string | null>(webhookPath ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState<NomodPendingCheckout[] | null>(null);

  useEffect(() => setPath(webhookPath ?? null), [webhookPath]);

  const loadPending = useCallback(() => {
    getNomodPending(15).then(setPending, () => setPending([]));
  }, []);
  useEffect(() => {
    loadPending();
  }, [loadPending]);

  const url = path ? `${API_URL}${path}` : null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast("Webhook URL copied");
    } catch {
      toast("Could not copy URL", "error");
    }
  }

  async function generate(rotate: boolean) {
    if (
      rotate &&
      !window.confirm(
        "Generate a new webhook URL? The current one stops working immediately, so paste the new one into Nomod right away.",
      )
    ) {
      return;
    }
    setBusy(rotate ? "rotate" : "generate");
    try {
      const res = await (rotate ? nomodRotateWebhookUrl() : nomodWebhookUrl());
      setPath(res.webhookPath);
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create the webhook URL", "error");
    } finally {
      setBusy(null);
    }
  }

  async function runTest() {
    setBusy("test");
    setTest(null);
    try {
      setTest(await nomodTestConnection());
    } catch (err) {
      setTest({ ok: false, message: err instanceof Error ? err.message : "The test could not run." });
    } finally {
      setBusy(null);
    }
  }

  async function recheck(id: number) {
    setBusy(`recheck-${id}`);
    try {
      const res = await recheckNomodCheckout(id);
      toast(res.outcome === "paid" ? "Payment confirmed" : "Checked with Nomod, no change yet");
      loadPending();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not check this payment", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] p-3 space-y-2">
        <p className="text-xs font-medium text-text-secondary dark:text-zinc-300">
          In Nomod, create a Hosted Checkout webhook with all 8 charge events (created, authorised, completed, failed,
          cancelled, refunded, partially refunded, dispute created) and paste this address as its URL. Then paste the
          whsec_ signing secret Nomod shows you into the field above. Keep this address private: it identifies your shop.
        </p>
        {url ? (
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-surface dark:bg-zinc-900 border border-border dark:border-white/10 rounded px-2 py-1.5 overflow-x-auto whitespace-nowrap">
              {url}
            </code>
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-1 text-xs text-accent-text dark:text-accent hover:underline cursor-pointer shrink-0"
            >
              <Copy className="size-3" />
              Copy
            </button>
          </div>
        ) : (
          <Button type="button" variant="secondary" size="sm" loading={busy === "generate"} onClick={() => generate(false)}>
            Generate webhook URL
          </Button>
        )}
        {url && (
          <button
            type="button"
            onClick={() => generate(true)}
            disabled={busy === "rotate"}
            className="text-xs text-text-faint hover:underline cursor-pointer"
          >
            Generate a new URL
          </button>
        )}
      </div>

      <div className="rounded-lg border border-border dark:border-white/10 p-3 space-y-2">
        <p className="text-xs text-text-faint">
          Partial refunds: Nomod does not document partial refunds. By default only a refund of the whole charge goes
          through Nomod; any other refund is recorded for you to do by hand in the Nomod dashboard. Turn on
          &quot;Allow partial refunds through Nomod&quot; above only after you have confirmed with Nomod that your account
          supports them.
        </p>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={busy === "test"}
            disabled={!hasApiKey}
            onClick={runTest}
          >
            Test connection
          </Button>
          {test && (
            <span role="status" className={`text-xs ${test.ok ? "text-green-600 dark:text-green-400" : "text-red-600"}`}>
              {test.message}
            </span>
          )}
        </div>
        <p className="text-xs text-text-faint">
          The test makes one harmless read with your saved API key. It is a best-effort check: Nomod documents no
          dedicated test call.
        </p>
      </div>

      {pending && pending.length > 0 && (
        <div className="rounded-lg border border-border dark:border-white/10 p-3 space-y-2">
          <p className="text-xs font-medium text-text-secondary dark:text-zinc-300">
            Nomod payments that need a look
          </p>
          <ul className="space-y-2">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                <span>
                  Order #{p.shopOrderNumber}, {p.amount} {p.currency}:{" "}
                  {p.disputed
                    ? "dispute opened"
                    : p.status === "review"
                      ? "did not match the order, not marked paid"
                      : "waiting for confirmation"}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={busy === `recheck-${p.id}`}
                  onClick={() => recheck(p.id)}
                >
                  Check with Nomod
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
