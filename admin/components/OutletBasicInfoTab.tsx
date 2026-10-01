"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { getShop, updateOutlet } from "@/lib/api";
import { normalizePhone } from "@/lib/validators";
import type { Outlet, Shop } from "@/lib/types";
import { mergeBusinessHours } from "@/lib/business-hours";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import Card from "@/components/ui/Card";
import BusinessHoursEditor from "@/components/BusinessHoursEditor";
import ShopWideSummary from "@/components/ShopWideSummary";
import { useToast } from "@/components/ui/Toast";

const LANGUAGE_LABELS: Record<string, string> = { en: "English", ar: "Arabic" };

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

  const toast = useToast();

  useEffect(() => {
    getShop()
      .then(setShop)
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
            Country, Time Zone, Currency, and Default Language are shop-wide, not per outlet. Country and Time Zone
            are in Settings &gt; Business Information, Currency in Settings &gt; Selling &gt; Money &amp; Tax, and
            Default Language in Settings &gt; Store Configuration.
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

      {shop && (
        <ShopWideSummary
          title="Order and Tax Settings"
          rows={[
            { label: "Same-day orders", value: shop.allowSameDayOrders ? "On" : "Off" },
            { label: "Next-day orders", value: shop.allowNextDayOrders ? "On" : "Off" },
            { label: "Tax Rate", value: `${Number(shop.taxRate) || 0}%` },
            { label: "Tax Type", value: shop.taxInclusive ? "Inclusive" : "Exclusive" },
            { label: "Tax on delivery fee", value: shop.taxOnDelivery ? "On" : "Off" },
          ]}
          links={[
            { href: "/settings/selling/money-tax", label: "Change tax for all outlets" },
            { href: "/settings/fulfilment/delivery", label: "Change order dates for all outlets" },
          ]}
        />
      )}

      <Button variant="primary" onClick={handleSave} disabled={saving}>
        <Check className="size-4 inline -mt-0.5 me-1" />
        Save changes
      </Button>

    </div>
  );
}
