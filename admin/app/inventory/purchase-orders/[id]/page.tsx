"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Ban, PackageCheck, Pencil, ScanBarcode, Send } from "lucide-react";
import { cancelPurchaseOrder, getPurchaseOrder, sendPurchaseOrder } from "@/lib/api";
import type { PurchaseOrderDetail } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import PageShell from "@/components/ui/PageShell";
import Tooltip from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import LoadFailed from "@/components/ui/LoadFailed";
import ScrollFade from "@/components/ui/ScrollFade";
import InventoryTabs from "@/components/InventoryTabs";
import PurchaseOrderStatusBadge from "@/components/PurchaseOrderStatusBadge";
import ReceivePurchaseOrderModal from "@/components/ReceivePurchaseOrderModal";
import ScanReceiveModal from "@/components/ScanReceiveModal";
import EditPurchaseOrderLinesModal from "@/components/EditPurchaseOrderLinesModal";

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const toast = useToast();
  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [editingLines, setEditingLines] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let live = true;
    getPurchaseOrder(id)
      .then((row) => {
        if (!live) return;
        setPo(row);
        setError(null);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : "Failed to load purchase order");
      });
    return () => {
      live = false;
    };
  }, [id, version]);

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast(success);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "error");
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  }

  const canReceive = po && (po.status === "sent" || po.status === "partially_received");
  const canCancel = po && (po.status === "draft" || po.status === "sent");

  return (
    <PageShell variant="wide">
      <BackButton href="/inventory/purchase-orders" />
      <InventoryTabs />
      {error && po && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}
      {error && !po && <LoadFailed what="the purchase order" onRetry={refresh} />}
      {po && (
        <div className="space-y-5">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50">{po.poNumber}</h1>
                <div className="mt-1 flex items-center gap-2 text-sm text-text-secondary dark:text-zinc-300">
                  <PurchaseOrderStatusBadge status={po.status} />
                  <span>{po.supplier?.name}</span>
                  <span className="text-text-muted">into {po.outlet?.name}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {po.status === "draft" && (
                  <>
                    <Tooltip label="Edit lines">
                      <Button variant="secondary" onClick={() => setEditingLines(true)} aria-label="Edit lines">
                        <Pencil className="size-4" />
                      </Button>
                    </Tooltip>
                    <Button variant="primary" disabled={busy} onClick={() => act(() => sendPurchaseOrder(po.id), `${po.poNumber} sent`)}>
                      <Send className="-mt-0.5 me-1 inline size-4" />
                      Mark as sent
                    </Button>
                  </>
                )}
                {canReceive && (
                  <Button variant="secondary" onClick={() => setScanning(true)}>
                    <ScanBarcode className="-mt-0.5 me-1 inline size-4" />
                    Scan to receive
                  </Button>
                )}
                {canReceive && (
                  <Button variant="primary" onClick={() => setReceiving(true)}>
                    <PackageCheck className="-mt-0.5 me-1 inline size-4" />
                    Receive delivery
                  </Button>
                )}
                {canCancel && !confirmCancel && (
                  <Tooltip label="Cancel this purchase order">
                    <Button variant="secondary" onClick={() => setConfirmCancel(true)} aria-label="Cancel purchase order">
                      <Ban className="size-4" />
                    </Button>
                  </Tooltip>
                )}
                {canCancel && confirmCancel && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-text-secondary dark:text-zinc-300">Cancel this order?</span>
                    <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
                      Keep
                    </Button>
                    <Button variant="primary" disabled={busy} onClick={() => act(() => cancelPurchaseOrder(po.id), `${po.poNumber} cancelled`)}>
                      Cancel order
                    </Button>
                  </div>
                )}
              </div>
            </div>
            {po.status === "partially_received" && (
              <p className="mt-3 text-sm text-text-muted">
                Part of this order is already in stock, so it can no longer be cancelled.
              </p>
            )}
            <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
              <Field label="Currency" value={po.currency} />
              <Field label="Expected delivery" value={po.expectedAt} />
              <Field label="Total" value={formatMoney(po.total, po.currency)} />
              {po.notes && (
                <div className="sm:col-span-3">
                  <Field label="Notes" value={po.notes} />
                </div>
              )}
            </dl>
          </Card>

          <Card>
            <h2 className="mb-3 text-base font-bold text-text-primary dark:text-zinc-50">Lines</h2>
            <ScrollFade stickyFirst>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11.5px] font-bold uppercase tracking-wide text-text-faint">
                    <th className="p-2 text-start">Item</th>
                    <th className="p-2 text-start">Supplier SKU</th>
                    <th className="p-2 text-end">Ordered</th>
                    <th className="p-2 text-end">Received</th>
                    <th className="p-2 text-end">Unit cost</th>
                    <th className="p-2 text-end">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {po.lines.map((l) => (
                    <tr key={l.id} className="border-t border-border-light dark:border-white/10">
                      <td className="p-2 font-semibold">{l.description}</td>
                      <td className="p-2">{l.supplierSku ?? <span className="text-text-muted">Not set</span>}</td>
                      <td className="p-2 text-end">{l.quantityOrdered}</td>
                      <td className="p-2 text-end">{l.quantityReceived}</td>
                      <td className="p-2 text-end">{formatMoney(l.unitCost, l.currency)}</td>
                      <td className="p-2 text-end">{formatMoney(l.lineTotal, l.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollFade>
          </Card>

          <Card>
            <h2 className="mb-3 text-base font-bold text-text-primary dark:text-zinc-50">Receipts</h2>
            {po.receipts.length === 0 ? (
              <p className="text-sm text-text-muted">Nothing received yet.</p>
            ) : (
              <ul className="space-y-3">
                {po.receipts.map((r) => (
                  <li key={r.id} className="rounded-xl border border-border p-3 text-sm dark:border-white/10">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-text-primary dark:text-zinc-100">
                        {new Date(r.receivedAt).toLocaleString()}
                        {r.deliveryNoteRef && <span className="ms-2 font-normal text-text-muted">Delivery note {r.deliveryNoteRef}</span>}
                      </span>
                      <span>{formatMoney(r.total, r.currency)}</span>
                    </div>
                    <ul className="mt-2 text-text-secondary dark:text-zinc-300">
                      {r.lines.map((rl) => {
                        const line = po.lines.find((l) => l.id === rl.poLineId);
                        return (
                          <li key={rl.id}>
                            {rl.quantity} x {line?.description ?? "Item"} at {formatMoney(rl.unitCost, r.currency)}
                          </li>
                        );
                      })}
                    </ul>
                    {r.note && <p className="mt-1 text-text-muted">{r.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {po && receiving && <ReceivePurchaseOrderModal po={po} onClose={() => setReceiving(false)} onReceived={refresh} />}
      {po && scanning && <ScanReceiveModal po={po} onClose={() => setScanning(false)} onReceived={refresh} />}
      {po && editingLines && <EditPurchaseOrderLinesModal po={po} onClose={() => setEditingLines(false)} onSaved={refresh} />}
    </PageShell>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[13px] font-medium text-text-secondary dark:text-zinc-400">{label}</dt>
      <dd className="mt-0.5 text-text-primary dark:text-zinc-100">{value ?? <span className="text-text-muted">Not set</span>}</dd>
    </div>
  );
}
