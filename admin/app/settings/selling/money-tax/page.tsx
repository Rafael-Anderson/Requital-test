"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { getShop, updateShop } from "@/lib/api";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Toggle from "@/components/ui/Toggle";
import PageShell from "@/components/ui/PageShell";
import { useToast } from "@/components/ui/Toast";

// Gulf-region currencies plus USD. SUPPORTED_CURRENCIES in the backend's
// UpdateShopDto is the real gate and matches this list (Phase 2a/A6).
const CURRENCIES = ["AED", "SAR", "KWD", "QAR", "BHD", "OMR", "USD"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-text-secondary dark:text-zinc-400 block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// Money & Tax (audit §14.4): the one home for currency, tax rate, tax type,
// tax on delivery and the tax label. Before this, currency and the label were
// in Store Configuration while the rate, the type and tax-on-delivery were
// reachable only through an outlet's Basic Info tab, i.e. three halves of one
// decision on two pages. All five are shop-wide fields written through the same
// PATCH /shop as before.
export default function MoneyTaxPage() {
  const [loaded, setLoaded] = useState(false);
  const [currency, setCurrency] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const [taxInclusive, setTaxInclusive] = useState(true);
  const [taxOnDelivery, setTaxOnDelivery] = useState(false);
  const [taxDisplayText, setTaxDisplayText] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    getShop().then((s) => {
      setCurrency(s.currency);
      setTaxRate(s.taxRate);
      setTaxInclusive(s.taxInclusive);
      setTaxOnDelivery(s.taxOnDelivery);
      setTaxDisplayText(s.taxDisplayText ?? "");
      setLoaded(true);
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await updateShop({
        currency,
        taxRate: Number(taxRate) || 0,
        taxInclusive,
        taxOnDelivery,
        taxDisplayText,
      });
      toast("Money and tax settings saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save money and tax settings", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <p className="text-sm text-text-muted">Loading…</p>;

  return (
    <PageShell>
      <div className="space-y-4">
        <Card>
          <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-1">Currency</h3>
          <p className="text-xs text-text-faint mb-4">Shop-wide.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Currency">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="flex h-9 w-full rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-text-faint">
                Applies to new orders. Orders already placed keep the currency they
                were charged in, so past totals, invoices and reports do not change.
              </p>
            </Field>
          </div>
        </Card>

        <Card>
          <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-1">Tax</h3>
          <p className="text-xs text-text-faint mb-4">
            Shop-wide, not per outlet. Each product is taxed at the rate of its own tax class; classes are managed
            under{" "}
            <Link href="/settings/business/tax-classes" className="text-accent-text dark:text-accent hover:underline">
              Tax Classes
            </Link>
            .
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Input
              label="Tax Rate (%)"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
            />
            <Field label="Tax Type">
              <SegmentedToggle
                value={taxInclusive ? "inclusive" : "exclusive"}
                onChange={(v) => setTaxInclusive(v === "inclusive")}
                options={[
                  { value: "exclusive", label: "Exclusive" },
                  { value: "inclusive", label: "Inclusive" },
                ]}
              />
            </Field>
            <Field label="Tax on delivery fee">
              <Toggle
                checked={taxOnDelivery}
                onChange={setTaxOnDelivery}
                tooltip="Off applies tax to the goods only, which is how orders have always been priced here."
              />
            </Field>
            <Input
              label="Tax Display Text"
              placeholder="e.g. Including VAT"
              value={taxDisplayText}
              onChange={(e) => setTaxDisplayText(e.target.value)}
            />
          </div>
        </Card>

        <Button variant="primary" onClick={handleSave} disabled={saving} loading={saving} className="w-fit">
          <Check className="size-4 inline -mt-0.5 mr-1" />
          Save changes
        </Button>
      </div>
    </PageShell>
  );
}
