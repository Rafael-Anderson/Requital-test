"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { getShop, updateOutlet, updateShop } from "@/lib/api";
import { normalizePhone } from "@/lib/validators";
import type { Outlet, Shop } from "@/lib/types";
import { mergeBusinessHours } from "@/lib/business-hours";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Checkbox from "@/components/ui/Checkbox";
import Toggle from "@/components/ui/Toggle";
import Card from "@/components/ui/Card";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import BusinessHoursEditor from "@/components/BusinessHoursEditor";
import ShopWideChangeModal from "@/components/ShopWideChangeModal";
import { diffShopWideChanges } from "@/lib/shop-wide-fields";
import { useToast } from "@/components/ui/Toast";

const LANGUAGE_LABELS: Record<string, string> = { en: "English", ar: "Arabic" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-text-secondary dark:text-zinc-400 block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

export default function OutletBasicInfoTab({
  outlet,
  onSaved,
}: {
  outlet: Outlet;
  onSaved: () => void;
}) {
  const [name, setName] = useState(outlet.name);
  const [nameAr, setNameAr] = useState(outlet.nameAr ?? "");
  const [email, setEmail] = useState(outlet.email ?? "");
  const [phone, setPhone] = useState(outlet.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(outlet.whatsapp ?? "");
  const [businessHours, setBusinessHours] = useState(mergeBusinessHours(outlet.businessHours));
  const [closedOverride, setClosedOverride] = useState(outlet.closedOverride);
  const [saving, setSaving] = useState(false);
  // Read-only display only — Country/Time Zone/Currency/Default Language
  // are shop-wide (see the Business Information / Store Configuration
  // tabs), deliberately not per-outlet fields. Fetched here just to show
  // their current value on this tab, never written back from it.
  const [shop, setShop] = useState<Shop | null>(null);

  const [allowSameDayOrders, setAllowSameDayOrders] = useState(true);
  const [allowNextDayOrders, setAllowNextDayOrders] = useState(true);
  const [taxRate, setTaxRate] = useState("0");
  const [taxInclusive, setTaxInclusive] = useState(true);
  const [savingOrderSettings, setSavingOrderSettings] = useState(false);
  // The shop-wide payload as loaded, for the "this changes every outlet"
  // confirm (lib/shop-wide-fields.ts). Re-baselined after a successful save
  // so a second save of the same values does not re-prompt.
  const [shopBaseline, setShopBaseline] = useState<Record<string, unknown> | null>(null);
  const [pendingChanges, setPendingChanges] = useState<string[] | null>(null);

  const toast = useToast();

  useEffect(() => {
    getShop()
      .then((s) => {
        setShop(s);
        setAllowSameDayOrders(s.allowSameDayOrders);
        setAllowNextDayOrders(s.allowNextDayOrders);
        setTaxRate(s.taxRate);
        setTaxInclusive(s.taxInclusive);
        setShopBaseline({
          allowSameDayOrders: s.allowSameDayOrders,
          allowNextDayOrders: s.allowNextDayOrders,
          taxRate: Number(s.taxRate) || 0,
          taxInclusive: s.taxInclusive,
        });
      })
      .catch(() => {});
  }, []);

  async function handleSave() {
    if (!name.trim()) {
      toast("Name is required", "error");
      return;
    }
    setSaving(true);
    try {
      await updateOutlet(outlet.id, {
        name,
        nameAr: nameAr || undefined,
        email: email || undefined,
        phone: phone || undefined,
        whatsapp: whatsapp || undefined,
        businessHours,
        closedOverride,
      });
      toast("Basic information saved");
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  function buildShopPayload() {
    return {
      allowSameDayOrders,
      allowNextDayOrders,
      taxRate: Number(taxRate) || 0,
      taxInclusive,
    };
  }

  // Every field on this card is shop-wide, so a save that changes one of them
  // confirms first. Nothing changed = save straight through, unchanged from
  // before this guard existed.
  function requestSaveOrderSettings() {
    const changes = diffShopWideChanges(shopBaseline, buildShopPayload());
    if (changes.length === 0) {
      void handleSaveOrderSettings();
      return;
    }
    setPendingChanges(changes);
  }

  async function handleSaveOrderSettings() {
    setSavingOrderSettings(true);
    try {
      const payload = buildShopPayload();
      await updateShop(payload);
      setShopBaseline(payload);
      setPendingChanges(null);
      toast("Order settings saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save order settings", "error");
    } finally {
      setSavingOrderSettings(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-sm font-semibold mb-3">Basic Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input label="Name in Arabic" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold mb-3">Contact Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input
            label="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={(e) => setPhone(normalizePhone(e.target.value))}
          />

          <Input
            label="WhatsApp"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            onBlur={(e) => setWhatsapp(normalizePhone(e.target.value))}
          />
          {/* Tax Registration Number: no such field exists anywhere in the
              data model yet — not even at the shop level — so there's
              nothing to read-only-pull the way Country/Time Zone/Currency/
              Default Language do below. Omitted rather than inventing a new
              column for what's meant to be a layout-only pass; the empty
              cell keeps this row's shape matching the reference. */}
          <div aria-hidden="true" />

          <Input label="Country" value={shop?.country ?? ""} disabled placeholder="-" />
          <Input label="Time Zone" value={shop?.timezone ?? ""} disabled />

          <Input label="Currency" value={shop?.currency ?? ""} disabled />
          <Input
            label="Default Language"
            value={shop ? (LANGUAGE_LABELS[shop.defaultLanguage] ?? shop.defaultLanguage) : ""}
            disabled
          />

          <p className="sm:col-span-2 text-xs text-text-faint -mt-2">
            Country, Time Zone, Currency, and Default Language are shop-wide. Change them under
            Settings → Business Settings, not per outlet.
          </p>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold mb-2">Hours</h3>
        <BusinessHoursEditor value={businessHours} onChange={setBusinessHours} />
        <div className="mt-3 flex items-center gap-2">
          <Toggle checked={closedOverride} onChange={setClosedOverride} />
          <span className="text-sm">Force closed (overrides hours regardless of schedule)</span>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold mb-1">Order Setting</h3>
        <p className="text-xs text-text-faint mb-4">
          These apply shop-wide, across every outlet, not just this one.
        </p>

        <div className="space-y-5">
          <div>
            <p className="text-sm font-medium text-text-secondary dark:text-zinc-400 mb-2">
              Select the dates customers can place orders for
            </p>
            <div className="space-y-2">
              <Checkbox
                label="Same-day orders"
                checked={allowSameDayOrders}
                onChange={(e) => setAllowSameDayOrders(e.target.checked)}
              />
              <Checkbox
                label="Next-day orders"
                checked={allowNextDayOrders}
                onChange={(e) => setAllowNextDayOrders(e.target.checked)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          </div>

          <Button variant="primary" onClick={requestSaveOrderSettings} disabled={savingOrderSettings}>
            <Check className="size-4 inline -mt-0.5 mr-1" />
            Save changes
          </Button>
        </div>
      </Card>

      <Button variant="primary" onClick={handleSave} disabled={saving}>
        <Check className="size-4 inline -mt-0.5 mr-1" />
        Save changes
      </Button>

      {pendingChanges && (
        <ShopWideChangeModal
          outletName={outlet.name}
          changes={pendingChanges}
          saving={savingOrderSettings}
          onConfirm={() => void handleSaveOrderSettings()}
          onCancel={() => setPendingChanges(null)}
        />
      )}
    </div>
  );
}
