"use client";

import { useEffect, useState } from "react";
import { generateInvoice, getInvoiceHtml, listInvoicesForOrder } from "@/lib/api";
import type { Invoice, InvoiceType } from "@/lib/types";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

const TYPE_LABEL: Record<InvoiceType, string> = {
  INVOICE: "Invoice",
  PACKING_SLIP: "Packing Slip",
};
const TYPES: InvoiceType[] = ["INVOICE", "PACKING_SLIP"];

// The Order detail modal's Invoice tab: generate (or, once one exists, just
// view) the invoice/packing slip for this order. Preview is fetched as HTML
// text via an authenticated fetch and rendered with `srcDoc` rather than
// pointing an iframe `src` at the API directly — the /invoices/:id/pdf
// endpoint requires the same Authorization: Bearer header every other admin
// request does, which a plain iframe src can't attach (see
// lib/api.ts's apiFetchText).
export default function OrderInvoiceTab({ orderId }: { orderId: number }) {
  const toast = useToast();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [generating, setGenerating] = useState<InvoiceType | null>(null);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [loadingHtml, setLoadingHtml] = useState(false);

  useEffect(() => {
    listInvoicesForOrder(orderId)
      .then(setInvoices)
      .catch(() => setInvoices([]));
  }, [orderId]);

  // Auto-select whichever invoice already exists (preferring a real
  // Invoice over a Packing Slip) so an already-generated document shows its
  // preview immediately instead of requiring an extra click.
  useEffect(() => {
    if (invoices && invoices.length > 0 && !selected) {
      setSelected(invoices.find((i) => i.type === "INVOICE") ?? invoices[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices]);

  useEffect(() => {
    if (!selected) {
      setHtml(null);
      return;
    }
    setLoadingHtml(true);
    getInvoiceHtml(selected.id)
      .then(setHtml)
      .catch(() => setHtml(null))
      .finally(() => setLoadingHtml(false));
  }, [selected]);

  async function handleGenerate(type: InvoiceType) {
    setGenerating(type);
    try {
      const invoice = await generateInvoice(orderId, type);
      setInvoices((prev) => [...(prev ?? []).filter((i) => i.type !== type), invoice]);
      setSelected(invoice);
      toast(`${TYPE_LABEL[type]} generated`);
    } catch (err) {
      toast(err instanceof Error ? err.message : `Failed to generate ${TYPE_LABEL[type]}`, "error");
    } finally {
      setGenerating(null);
    }
  }

  function handlePrint() {
    if (!html) return;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  if (invoices === null) {
    return <p className="text-sm text-zinc-400">Loading…</p>;
  }

  const byType = (type: InvoiceType) => invoices.find((i) => i.type === type);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TYPES.map((type) => {
          const existing = byType(type);
          return existing ? (
            <Button
              key={type}
              variant={selected?.id === existing.id ? "primary" : "secondary"}
              size="sm"
              onClick={() => setSelected(existing)}
            >
              View {TYPE_LABEL[type]} ({existing.invoiceNumber})
            </Button>
          ) : (
            <Button
              key={type}
              variant="secondary"
              size="sm"
              onClick={() => handleGenerate(type)}
              disabled={generating === type}
              loading={generating === type}
            >
              Generate {TYPE_LABEL[type]}
            </Button>
          );
        })}
      </div>

      {selected && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={handlePrint} disabled={!html}>
              Print / Download PDF
            </Button>
          </div>
          <div className="border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden bg-white">
            {loadingHtml ? (
              <p className="text-sm text-zinc-400 p-4">Loading preview…</p>
            ) : (
              <iframe
                title={`${TYPE_LABEL[selected.type]} preview`}
                srcDoc={html ?? ""}
                className="w-full h-[480px]"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
