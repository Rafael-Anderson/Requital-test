"use client";

import { useEffect, useState } from "react";
import {
  generateInvoice,
  getCreditNoteHtml,
  getInvoiceHtml,
  getOrderReturns,
  issueCreditNote,
  listCreditNotesForOrder,
  listInvoicesForOrder,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import type { CreditNote, Invoice, InvoiceType, OrderReturn } from "@/lib/types";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
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
  // Credit notes are documents only: issuing one never touches the order, its
  // payments or its returns. Previewed in the same iframe as the invoice.
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [returns, setReturns] = useState<OrderReturn[]>([]);
  const [selectedCn, setSelectedCn] = useState<CreditNote | null>(null);
  const [choice, setChoice] = useState("correction");
  const [issuing, setIssuing] = useState(false);

  useEffect(() => {
    listInvoicesForOrder(orderId)
      .then(setInvoices)
      .catch(() => setInvoices([]));
    listCreditNotesForOrder(orderId)
      .then(setCreditNotes)
      .catch(() => setCreditNotes([]));
    getOrderReturns(orderId)
      .then(setReturns)
      .catch(() => setReturns([]));
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
    if (!selected && !selectedCn) {
      setHtml(null);
      return;
    }
    setLoadingHtml(true);
    (selectedCn ? getCreditNoteHtml(selectedCn.id) : getInvoiceHtml(selected!.id))
      .then(setHtml)
      .catch(() => setHtml(null))
      .finally(() => setLoadingHtml(false));
  }, [selected, selectedCn]);

  async function handleIssueCreditNote() {
    setIssuing(true);
    try {
      const returnId = choice.startsWith("return:") ? Number(choice.slice(7)) : undefined;
      const note = await issueCreditNote({
        orderId,
        reason: returnId ? "return" : (choice as "correction" | "cancellation"),
        returnId,
      });
      setCreditNotes((prev) => [...prev, note]);
      setSelectedCn(note);
      setChoice("correction");
      toast(`Credit note ${note.number} issued`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to issue credit note", "error");
    } finally {
      setIssuing(false);
    }
  }

  async function handleGenerate(type: InvoiceType) {
    setGenerating(type);
    try {
      const invoice = await generateInvoice(orderId, type);
      setInvoices((prev) => [...(prev ?? []).filter((i) => i.type !== type), invoice]);
      setSelectedCn(null);
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
    return <p className="text-sm text-text-faint">Loading…</p>;
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
              variant={!selectedCn && selected?.id === existing.id ? "primary" : "secondary"}
              size="sm"
              onClick={() => {
                setSelectedCn(null);
                setSelected(existing);
              }}
            >
              View {TYPE_LABEL[type]} ({existing.invoiceNumber})
              {existing.supersededAt ? " *" : ""}
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

      {/* C2. The document is frozen at issue, so it stays a correct record of
          what was issued - it just no longer matches the order after an edit,
          cancellation or return. Staff need to know that before handing it to a
          customer. A packing slip renders live and is never marked. */}
      {TYPES.some((type) => byType(type)?.supersededAt) && (
        <p className="text-[13px] rounded-lg px-3 py-2 bg-amber-50 text-amber-900 border border-amber-200">
          This invoice predates the current order. It still shows what was
          issued, which is why it has not changed, but the order has been
          modified since.
        </p>
      )}

      {byType("INVOICE") && (
        <div className="space-y-2 rounded-lg border border-border dark:border-white/10 p-3">
          <p className="text-[13px] font-medium text-text-secondary">Credit notes</p>
          {creditNotes.length === 0 && (
            <p className="text-[13px] text-text-faint">No credit notes issued for this order.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {creditNotes.map((cn) => (
              <Button
                key={cn.id}
                variant={selectedCn?.id === cn.id ? "primary" : "secondary"}
                size="sm"
                onClick={() => setSelectedCn(cn)}
              >
                {cn.number} ({formatMoney(cn.total, cn.currency)})
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Select
              label="Issue a credit note for"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              className="min-w-[220px]"
            >
              <option value="correction">Whole invoice (correction)</option>
              <option value="cancellation">Whole invoice (cancellation)</option>
              {returns
                .filter((r) => !creditNotes.some((cn) => cn.returnId === r.id))
                .map((r) => (
                  <option key={r.id} value={`return:${r.id}`}>
                    Return #{r.id}
                  </option>
                ))}
            </Select>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleIssueCreditNote}
              disabled={issuing}
              loading={issuing}
            >
              Issue credit note
            </Button>
          </div>
          <p className="text-[12px] text-text-faint">
            A credit note is a document only. It does not refund, restock or change the order.
          </p>
        </div>
      )}

      {(selected || selectedCn) && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={handlePrint} disabled={!html}>
              Print / Download PDF
            </Button>
          </div>
          <div className="border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden bg-surface">
            {loadingHtml ? (
              <p className="text-sm text-text-faint p-4">Loading preview…</p>
            ) : (
              <iframe
                title={selectedCn ? "Credit note preview" : `${TYPE_LABEL[selected!.type]} preview`}
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
