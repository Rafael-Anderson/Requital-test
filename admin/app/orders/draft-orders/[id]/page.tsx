"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Mail, MessageCircle } from "lucide-react";
import {
  cancelDraftOrder,
  cancelDraftPaymentLink,
  convertDraftCod,
  emailDraftInvoice,
  getDraftOrder,
  markDraftPaid,
  sendDraftPaymentLink,
} from "@/lib/api";
import {
  ADMIN_ORDER_SOURCE_LABELS,
  DRAFT_ORDER_STATUS_LABELS,
  MANUAL_PAYMENT_METHODS,
  MANUAL_PAYMENT_METHOD_LABELS,
  type DraftOrder,
  type ManualPaymentMethod,
} from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Combobox from "@/components/ui/Combobox";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import DraftOrderBuilder from "@/components/DraftOrderBuilder";
import PageShell from "@/components/ui/PageShell";
import Money from "@/components/Money";
import { formatMoney } from "@/lib/money";
import { whatsappShareUrl } from "@/lib/draft-share";

export default function DraftOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const toast = useToast();
  const draftId = Number(params.id);

  const [draft, setDraft] = useState<DraftOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [paidMethod, setPaidMethod] = useState<ManualPaymentMethod>("cash");
  const [paidReference, setPaidReference] = useState("");

  const refresh = useCallback(() => {
    return getDraftOrder(draftId).then(
      (d) => {
        setDraft(d);
        setError(null);
      },
      (err) => setError(err instanceof Error ? err.message : "Failed to load draft order"),
    );
  }, [draftId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(key: string, action: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await action();
      toast(done);
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Something went wrong", "error");
    } finally {
      setBusy(null);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      toast("Could not copy the link", "error");
    }
  }

  if (!draft) {
    return (
      <div>
        <BackButton href="/orders/draft-orders" />
        {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}
        {/* A failed load shows only the error above (it used to sit on this
            skeleton forever). */}
        {!error && (
          <PageShell variant="form">
            <CardSkeleton />
          </PageShell>
        )}
      </div>
    );
  }

  const editable = draft.status === "OPEN" || draft.status === "INVOICE_SENT" || draft.status === "AWAITING_PAYMENT";
  const active = draft.status === "OPEN" || draft.status === "INVOICE_SENT";
  const linkLive = draft.status === "INVOICE_SENT" || draft.status === "AWAITING_PAYMENT";
  const bill = draft.bill;
  const total = bill?.total ?? null;
  const shareMessage =
    draft.payLink && total !== null
      ? `Hello ${draft.customerName}, here is your order from us: ${formatMoney(total, draft.currency)}. Pay here: ${draft.payLink.url}`
      : "";

  if (editing && editable) {
    return (
      <div>
        <BackButton href="/orders/draft-orders" />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Edit draft order</h1>
          <Button variant="secondary" onClick={() => setEditing(false)}>
            Back to the draft
          </Button>
        </div>
        {linkLive && (
          <p className="mb-4 text-sm text-amber-700 dark:text-amber-400">
            A payment link is out. Saving changes re-locks it at the new prices; the same link keeps working.
            {draft.status === "AWAITING_PAYMENT" && " The customer's open payment is cancelled."}
          </p>
        )}
        <DraftOrderBuilder draft={draft} />
      </div>
    );
  }

  return (
    <div>
      <BackButton href="/orders/draft-orders" />
      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}
      <PageShell variant="form">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-2xl font-semibold">Draft order for {draft.customerName}</h1>
              <p className="text-sm text-text-muted">
                {DRAFT_ORDER_STATUS_LABELS[draft.status]}
                {draft.createdBy?.name ? ` · Created by ${draft.createdBy.name}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {editable && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              {editable && (
                <Button
                  variant="danger"
                  loading={busy === "cancel"}
                  onClick={() => {
                    if (!window.confirm("Cancel this draft order?")) return;
                    void run("cancel", () => cancelDraftOrder(draftId), "Draft order cancelled");
                  }}
                >
                  Cancel draft
                </Button>
              )}
            </div>
          </div>

          <Card className="space-y-3">
            <p className="text-sm">
              <span className="text-text-muted">Customer:</span> {draft.customerName} ({draft.customerPhone})
              {draft.customerEmail ? `, ${draft.customerEmail}` : ""}
            </p>
            <p className="text-sm">
              <span className="text-text-muted">{draft.orderType === "pickup" ? "Pickup at" : "Delivery from"}:</span>{" "}
              {draft.outlet.name}
              {draft.orderType === "delivery" && draft.customerAddress ? ` to ${draft.customerAddress}` : ""}
              {draft.deliveryDate ? `, ${draft.deliveryDate}${draft.deliveryTimeSlot ? ` ${draft.deliveryTimeSlot}` : ""}` : ""}
            </p>
            {draft.receiverName && (
              <p className="text-sm">
                <span className="text-text-muted">Receiver:</span> {draft.receiverName} ({draft.receiverPhone})
              </p>
            )}
            {draft.notes && (
              <p className="text-sm">
                <span className="text-text-muted">Internal note:</span> {draft.notes}
              </p>
            )}
            {bill ? (
              <div className="space-y-1 border-t border-black/5 pt-3 text-sm dark:border-white/10" data-testid="draft-bill">
                {bill.lines.map((l, i) => (
                  <div key={i} className="flex justify-between gap-2">
                    <span>
                      {l.quantity} × {l.name}
                      {l.variantLabel ? ` · ${l.variantLabel}` : ""}
                      {l.priceOverridden && l.priceReason ? (
                        <span className="text-xs text-text-muted"> (price changed: {l.priceReason})</span>
                      ) : null}
                    </span>
                    <Money amount={l.lineTotal} currency={bill.currency} />
                  </div>
                ))}
                <div className="flex justify-between pt-2 text-text-muted">
                  <span>Subtotal</span>
                  <Money amount={bill.subtotal} currency={bill.currency} />
                </div>
                {Number(bill.discount.amount) > 0 && (
                  <div className="flex justify-between text-green-600 dark:text-green-400">
                    <span>Discount{bill.discount.code ? ` (${bill.discount.code})` : bill.discount.reason ? ` (${bill.discount.reason})` : ""}</span>
                    <span>
                      -<Money amount={bill.discount.amount} currency={bill.currency} />
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-text-muted">
                  <span>{draft.orderType === "pickup" ? "Pickup" : "Delivery"}</span>
                  <span>
                    {bill.deliveryFee === null ? "Not priced yet" : <Money amount={bill.deliveryFee} currency={bill.currency} />}
                  </span>
                </div>
                {bill.taxAmount !== null && (
                  <div className="flex justify-between text-text-muted">
                    <span>{bill.taxInclusive ? "Includes tax" : "Tax"}</span>
                    <Money amount={bill.taxAmount} currency={bill.currency} />
                  </div>
                )}
                <div className="flex justify-between border-t border-black/5 pt-2 font-semibold dark:border-white/10">
                  <span>Total</span>
                  <span>{total === null ? "" : <Money amount={total} currency={bill.currency} />}</span>
                </div>
                {bill.deliveryError && <p className="text-xs text-amber-700 dark:text-amber-400">{bill.deliveryError}</p>}
                {draft.billLocked && (
                  <p className="text-xs text-text-faint">Prices locked when the payment link was created.</p>
                )}
              </div>
            ) : (
              draft.billError && <InlineErrorMessage>{draft.billError}</InlineErrorMessage>
            )}
          </Card>

          {active && (
            <Card className="space-y-3">
              <h2 className="text-sm font-semibold">Payment</h2>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  disabled={!draft.cardAvailable}
                  loading={busy === "link"}
                  onClick={() =>
                    void run("link", () => sendDraftPaymentLink(draftId), draft.payLink ? "Payment link re-sent" : "Payment link created")
                  }
                >
                  {draft.payLink ? "Refresh payment link" : "Card payment link"}
                </Button>
                <Button
                  variant="secondary"
                  loading={busy === "cod"}
                  onClick={() => {
                    if (!window.confirm("Place this as a cash order now? It goes to the kanban with payment pending.")) return;
                    void run("cod", () => convertDraftCod(draftId), "Order placed, cash on " + (draft.orderType === "pickup" ? "pickup" : "delivery"));
                  }}
                >
                  Cash on {draft.orderType === "pickup" ? "pickup" : "delivery"}
                </Button>
                <Button variant="secondary" onClick={() => setMarkPaidOpen(true)}>
                  Mark as paid
                </Button>
              </div>
              {!draft.cardAvailable && (
                <p className="text-xs text-text-muted" data-testid="card-unavailable">
                  Card payment links need a working card processor.{" "}
                  <Link href="/integrations/payments" className="text-accent-text hover:underline">
                    Set one up in Integrations &gt; Payments
                  </Link>
                  .
                </p>
              )}
              <p className="text-xs text-text-faint">Or keep it as a draft: nothing is reserved until the order is placed.</p>
            </Card>
          )}

          {linkLive && draft.payLink && (
            <Card className="space-y-3">
              <h2 className="text-sm font-semibold">
                Payment link{draft.status === "AWAITING_PAYMENT" ? " · the customer is paying" : ""}
              </h2>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  aria-label="Payment link"
                  value={draft.payLink.url}
                  className="h-8 min-w-0 flex-1 rounded border border-border bg-transparent px-2 text-xs dark:border-white/15"
                />
                <Button size="sm" variant="secondary" className="shrink-0" onClick={() => void copy(draft.payLink!.url)}>
                  <Copy className="size-3.5" />
                  Copy link
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={whatsappShareUrl(draft.customerPhone, shareMessage)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-[10px] border border-border px-3 py-1.5 text-sm font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
                >
                  <MessageCircle className="size-4" />
                  Share on WhatsApp
                </a>
                <Button
                  variant="secondary"
                  disabled={!draft.customerEmail}
                  loading={busy === "email"}
                  onClick={() => void run("email", () => emailDraftInvoice(draftId), "Invoice emailed")}
                >
                  <Mail className="size-4" />
                  Email invoice
                </Button>
                <Button
                  variant="danger"
                  loading={busy === "cancel-link"}
                  onClick={() => {
                    if (!window.confirm("Cancel the payment link? It stops working at once.")) return;
                    void run("cancel-link", () => cancelDraftPaymentLink(draftId), "Payment link cancelled");
                  }}
                >
                  Cancel link
                </Button>
              </div>
              {draft.payLink.expiresAt && (
                <p className="text-xs text-text-faint">Valid until {new Date(draft.payLink.expiresAt).toLocaleDateString()}</p>
              )}
            </Card>
          )}

          {draft.orders.length > 0 && (
            <Card className="space-y-2">
              <h2 className="text-sm font-semibold">Orders</h2>
              <ul className="space-y-1 text-sm">
                {draft.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap justify-between gap-2">
                    <Link href={`/orders/${o.id}`} className="text-accent-text hover:underline">
                      Order #{o.shopOrderNumber}
                    </Link>
                    <span className="text-text-muted">
                      {o.adminSource ? ADMIN_ORDER_SOURCE_LABELS[o.adminSource] ?? o.adminSource : ""} · {o.status} ·{" "}
                      {o.paymentStatus === "paid" ? "Paid" : "Unpaid"} · <Money amount={o.total} currency={o.currency} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </PageShell>

      {markPaidOpen && (
      <Modal
        onClose={() => setMarkPaidOpen(false)}
        title="Mark as paid"
        size="sm"
        footer={(close) => (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy === "paid"}
              onClick={() => {
                setMarkPaidOpen(false);
                void run(
                  "paid",
                  () => markDraftPaid(draftId, { method: paidMethod, reference: paidReference.trim() || undefined }),
                  "Order placed and marked paid",
                );
              }}
            >
              Place order as paid
            </Button>
          </div>
        )}
      >
        <div className="space-y-4">
          <Combobox
            label="Paid by"
            value={paidMethod}
            onChange={(v) => setPaidMethod(v as ManualPaymentMethod)}
            options={MANUAL_PAYMENT_METHODS.map((m) => ({ value: m, label: MANUAL_PAYMENT_METHOD_LABELS[m] }))}
          />
          <Input label="Reference (optional)" value={paidReference} onChange={(e) => setPaidReference(e.target.value)} />
        </div>
      </Modal>
      )}
    </div>
  );
}
