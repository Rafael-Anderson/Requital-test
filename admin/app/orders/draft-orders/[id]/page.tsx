"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { cancelDraftOrder, completeDraftOrder, getDraftOrder, sendDraftOrderInvoice } from "@/lib/api";
import { DRAFT_ORDER_STATUS_LABELS, type DraftOrder } from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import DraftOrderBuilder from "@/components/DraftOrderBuilder";
import PageShell from "@/components/ui/PageShell";

export default function DraftOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const draftId = Number(params.id);

  const [draft, setDraft] = useState<DraftOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paymentLinkUrl, setPaymentLinkUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDraft(await getDraftOrder(draftId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load draft order");
    }
  }, [draftId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleComplete() {
    setBusy(true);
    try {
      await completeDraftOrder(draftId);
      toast("Marked as paid");
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to complete draft order", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendInvoice() {
    setBusy(true);
    try {
      const res = await sendDraftOrderInvoice(draftId);
      setPaymentLinkUrl(res.paymentLink.url);
      toast("Invoice link generated");
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to send invoice", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!confirm("Cancel this draft order?")) return;
    setBusy(true);
    try {
      await cancelDraftOrder(draftId);
      toast("Draft order cancelled");
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to cancel draft order", "error");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      toast("Could not copy link", "error");
    }
  }

  return (
    <div>
      <BackButton href="/orders/draft-orders" />
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      {!draft ? (
        <PageShell variant="form">
          <CardSkeleton />
        </PageShell>
      ) : draft.status === "OPEN" ? (
        <>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h1 className="text-2xl font-semibold">Draft order for {draft.customerName}</h1>
            <div className="flex gap-2">
              <Button variant="danger" onClick={handleCancel} disabled={busy}>
                Cancel order
              </Button>
              <Button variant="secondary" onClick={handleSendInvoice} disabled={busy}>
                Send invoice
              </Button>
              <Button variant="primary" onClick={handleComplete} disabled={busy}>
                Mark as paid
              </Button>
            </div>
          </div>
          <DraftOrderBuilder draft={draft} />
        </>
      ) : (
        <PageShell variant="form">
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h1 className="text-2xl font-semibold">Draft order for {draft.customerName}</h1>
              <span className="text-sm font-medium">{DRAFT_ORDER_STATUS_LABELS[draft.status]}</span>
            </div>

            <Card className="space-y-3">
              <p className="text-sm">
                <span className="text-text-muted">Customer:</span> {draft.customerName} ({draft.customerPhone})
              </p>
              <p className="text-sm">
                <span className="text-text-muted">Branch:</span> {draft.outlet.name}
              </p>
              <div className="divide-y divide-black/5 dark:divide-white/10">
                {draft.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      {item.productName}
                      {item.variantLabel ? ` · ${item.variantLabel}` : ""} × {item.quantity}
                    </span>
                    <span>{(Number(item.price) * item.quantity).toFixed(2)} AED</span>
                  </div>
                ))}
              </div>
              {draft.discount && (
                <p className="text-sm text-green-600 dark:text-green-400">
                  Discount ({draft.discount.code}): -{draft.discountAmount.toFixed(2)} AED
                </p>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-black/5 dark:border-white/10 font-medium">
                <span>Total</span>
                <span>{draft.total.toFixed(2)} AED</span>
              </div>
            </Card>

            {draft.convertedOrder && (
              <Card>
                <p className="text-sm">
                  Converted to{" "}
                  <Link href={`/orders/${draft.convertedOrder.id}`} className="text-accent-text hover:underline">
                    Order #{draft.convertedOrder.id}
                  </Link>{" "}
                  ({draft.convertedOrder.paymentStatus === "paid" ? "Paid" : "Unpaid"})
                </p>
                {paymentLinkUrl && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      readOnly
                      value={paymentLinkUrl}
                      className="flex-1 h-8 rounded border border-border dark:border-white/15 bg-transparent px-2 text-xs"
                    />
                    <Button size="sm" variant="secondary" onClick={() => copyLink(paymentLinkUrl)}>
                      Copy
                    </Button>
                  </div>
                )}
              </Card>
            )}

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => router.push("/orders/draft-orders")}>
                Back to list
              </Button>
              {draft.status === "INVOICE_SENT" && (
                <>
                  <Button variant="primary" onClick={handleComplete} disabled={busy}>
                    Mark as paid
                  </Button>
                  <Button variant="danger" onClick={handleCancel} disabled={busy}>
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>
        </PageShell>
      )}
    </div>
  );
}
