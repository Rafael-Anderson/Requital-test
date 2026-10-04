"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { getShop, updateShop } from "@/lib/api";
import { defaultBusinessHours, mergeBusinessHours } from "@/lib/business-hours";
import { TIME_SLOT_PRESETS } from "@/lib/time-slot-presets";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import { SettingsLoadFailed } from "@/components/SettingsContentSkeleton";
import Combobox from "@/components/ui/Combobox";
import BusinessHoursEditor from "@/components/BusinessHoursEditor";
import PaymentMethodsEditor, { type PaymentMethodsValue } from "@/components/PaymentMethodsEditor";
import { useToast } from "@/components/ui/Toast";

// The shop-wide pickup settings, moved here from an outlet's Pickup tab
// (audit §14.4). Same fields, same updateShop() payload as the tab sent.
export default function ShopPickupSettingsForm() {
  const [loaded, setLoaded] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodsValue>({
    cardOnline: true,
    cashOnFulfillment: true,
    cardOnFulfillment: false,
  });
  const [hours, setHours] = useState(defaultBusinessHours());
  const [timeSlotGapMinutes, setTimeSlotGapMinutes] = useState(30);
  const [preparationTimeMinutes, setPreparationTimeMinutes] = useState(15);
  const [preparationPlusTimeMinutes, setPreparationPlusTimeMinutes] = useState(30);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  // Try again bumps `reloadKey`; a failed request ends in an error with Try again, never "Loading" for good.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let live = true;
    getShop()
      .then((s) => {
        if (!live) return;
        setLoadError(null);
        setPaymentMethods({
          cardOnline: s.pickupPaymentCardOnline,
          cashOnFulfillment: s.pickupPaymentCashOnPickup,
          cardOnFulfillment: s.pickupPaymentCardOnPickup,
        });
        setHours(mergeBusinessHours(s.pickupHours));
        setTimeSlotGapMinutes(s.pickupTimeSlotGapMinutes);
        setPreparationTimeMinutes(s.pickupPreparationTimeMinutes);
        setPreparationPlusTimeMinutes(s.pickupPreparationPlusTimeMinutes);
        setLoaded(true);
      })
      .catch((err) => {
        if (live) setLoadError(err instanceof Error ? err.message : "Failed to load pickup settings");
      });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  async function handleSave() {
    setSaving(true);
    try {
      await updateShop({
        pickupPaymentCardOnline: paymentMethods.cardOnline,
        pickupPaymentCashOnPickup: paymentMethods.cashOnFulfillment,
        pickupPaymentCardOnPickup: paymentMethods.cardOnFulfillment,
        pickupHours: hours,
        pickupTimeSlotGapMinutes: timeSlotGapMinutes,
        pickupPreparationTimeMinutes: preparationTimeMinutes,
        pickupPreparationPlusTimeMinutes: preparationPlusTimeMinutes,
      });
      toast("Pickup settings saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save pickup settings", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return loadError ? (
      <SettingsLoadFailed
        what="pickup settings"
        onRetry={() => {
          setLoadError(null);
          setReloadKey((k) => k + 1);
        }}
      />
    ) : (
      <p className="text-sm text-text-muted">Loading pickup settings…</p>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-sm font-semibold mb-1">Pickup Settings</h3>
        <p className="text-xs text-text-faint mb-4">
          These apply to every outlet. Whether each outlet offers pickup is set on the outlet itself.
        </p>

        <div className="space-y-6">
          <div>
            <p className="text-sm font-medium text-text-secondary dark:text-zinc-400 mb-2">Payment Methods</p>
            <PaymentMethodsEditor context="pickup" value={paymentMethods} onChange={setPaymentMethods} />
            <p className="text-xs text-text-faint mt-2">
              Card (Paid Online) only works once a card processor is connected under{" "}
              <Link href="/integrations/payments" className="text-accent-text dark:text-accent hover:underline">
                Integrations &gt; Payments
              </Link>
              .
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-text-secondary dark:text-zinc-400 mb-2">Opening Hours for Pickup</p>
            <BusinessHoursEditor value={hours} onChange={setHours} />
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold mb-3">Preparation Time Settings</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Combobox
            label="Time Slot Gap"
            value={String(timeSlotGapMinutes)}
            onChange={(value) => setTimeSlotGapMinutes(Number(value))}
            options={TIME_SLOT_PRESETS.map((p) => ({ value: String(p.minutes), label: p.label }))}
          />
          <Input
            label="Preparation Time (minutes)"
            type="number"
            min="0"
            value={preparationTimeMinutes}
            onChange={(e) => setPreparationTimeMinutes(Number(e.target.value))}
          />
          <Input
            label="Preparation + Pickup Time (minutes)"
            type="number"
            min="0"
            value={preparationPlusTimeMinutes}
            onChange={(e) => setPreparationPlusTimeMinutes(Number(e.target.value))}
          />
        </div>
      </Card>

      <Button variant="primary" onClick={handleSave} disabled={saving} loading={saving} className="w-fit">
        <Check className="size-4 inline -mt-0.5 me-1" />
        Save changes
      </Button>
    </div>
  );
}
