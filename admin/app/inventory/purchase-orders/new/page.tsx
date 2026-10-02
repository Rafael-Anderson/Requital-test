"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createPurchaseOrder, listSuppliers } from "@/lib/api";
import { SUPPLIER_CURRENCIES, type SupplierListItem } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { useOutletFilter } from "@/lib/outlet-context";
import { newDraft, toLineInputs, type LineDraft } from "@/lib/purchase-order-lines";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import Input from "@/components/ui/Input";
import PageShell from "@/components/ui/PageShell";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import InventoryTabs from "@/components/InventoryTabs";
import PurchaseOrderLinesEditor, { usePurchasePickerOptions } from "@/components/PurchaseOrderLinesEditor";

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { outlets } = useOutletFilter();
  const options = usePurchasePickerOptions();
  const [suppliers, setSuppliers] = useState<SupplierListItem[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [outletId, setOutletId] = useState("");
  const [currency, setCurrency] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() => [newDraft()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listSuppliers("active")
      .then((rows) => {
        if (live) setSuppliers(rows);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : "Failed to load suppliers");
      });
    return () => {
      live = false;
    };
  }, []);

  const supplier = useMemo(() => suppliers.find((s) => String(s.id) === supplierId) ?? null, [suppliers, supplierId]);
  // The PO's currency: an explicit choice, else the supplier's own. Never guessed.
  const effectiveCurrency = currency || supplier?.currency || null;
  const isBranch = user?.role === "branch";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supplier) {
      setError("Choose a supplier.");
      return;
    }
    if (!effectiveCurrency) {
      setError("This supplier has no currency. Choose one for this purchase order.");
      return;
    }
    if (!isBranch && !outletId) {
      setError("Choose the receiving outlet.");
      return;
    }
    const parsed = toLineInputs(lines);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const po = await createPurchaseOrder({
        supplierId: supplier.id,
        ...(isBranch ? {} : { outletId: Number(outletId) }),
        ...(currency ? { currency } : {}),
        ...(expectedAt ? { expectedAt } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        lines: parsed.lines,
      });
      toast(`${po.poNumber} created as a draft`);
      router.push(`/inventory/purchase-orders/${po.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create purchase order");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell variant="wide">
      <BackButton href="/inventory/purchase-orders" />
      <InventoryTabs />
      <h1 className="mb-5 text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50">New purchase order</h1>
      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Select label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
              <option value="">Choose a supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            {!isBranch && (
              <Select label="Receiving outlet" value={outletId} onChange={(e) => setOutletId(e.target.value)} required>
                <option value="">Choose an outlet</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
            <Select
              label="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              tooltip="Defaults to the supplier's currency. Choose one only if this order is priced differently."
            >
              <option value="">{supplier?.currency ? `Supplier currency (${supplier.currency})` : "Not set"}</option>
              {SUPPLIER_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Input label="Expected delivery" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
            <div className="sm:col-span-2">
              <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-bold text-text-primary dark:text-zinc-50">Lines</h2>
          <PurchaseOrderLinesEditor value={lines} onChange={setLines} currency={effectiveCurrency} options={options} />
        </Card>

        {error && <InlineErrorMessage>{error}</InlineErrorMessage>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={saving} loading={saving}>
            {saving ? "Saving…" : "Save as draft"}
          </Button>
        </div>
      </form>
    </PageShell>
  );
}
