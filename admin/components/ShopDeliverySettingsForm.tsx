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
import Combobox from "@/components/ui/Combobox";
import BusinessHoursEditor from "@/components/BusinessHoursEditor";
import PaymentMethodsEditor, { type PaymentMethodsValue } from "@/components/PaymentMethodsEditor";
import { useToast } from "@/components/ui/Toast";
import SettingsContentSkeleton from "@/components/SettingsContentSkeleton";

// The shop-wide delivery settings, moved here from an outlet's Delivery tab
// (audit §14.4). Same fields, same updateShop() payload as the tab sent; the
// "this changes every outlet" confirm is gone because the page is shop-wide by
// construction.
export default function ShopDeliverySettingsForm() {
  const [loaded, setLoaded] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodsValue>({
    cardOnline: true,
    cashOnFulfillment: true,
    cardOnFulfillment: false,
  });
  const [hours, setHours] = useState(defaultBusinessHours());
  const [timeSlotGapMinutes, setTimeSlotGapMinutes] = useState(60);
  const [preparationTimeMinutes, setPreparationTimeMinutes] = useState(15);
  const [preparationPlusDeliveryTimeMinutes, setPreparationPlusDeliveryTimeMinutes] = useState(45);
  const [estimatedFrom, setEstimatedFrom] = useState(30);
  const [estimatedTo, setEstimatedTo] = useState(60);
  const [estimatedUnit, setEstimatedUnit] = useState<"minutes" | "hours" | "days">("minutes");
  // "HH:MM" shop-level same-day cutoff; "" means off.
  const [sameDayCutoff, setSameDayCutoff] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    getShop().then((s) => {
      setPaymentMethods({
        cardOnline: s.deliveryPaymentCardOnline,
        cashOnFulfillment: s.deliveryPaymentCashOnDelivery,
        cardOnFulfillment: s.deliveryPaymentCardOnDelivery,
      });
      setHours(mergeBusinessHours(s.deliveryHours));
      setTimeSlotGapMinutes(s.deliveryTimeSlotGapMinutes);
      setPreparationTimeMinutes(s.deliveryPreparationTimeMinutes);
      setPreparationPlusDeliveryTimeMinutes(s.deliveryPreparationPlusDeliveryTimeMinutes);
      setEstimatedFrom(s.estimatedDeliveryTimeFrom);
      setEstimatedTo(s.estimatedDeliveryTimeTo);
      setEstimatedUnit(s.estimatedDeliveryTimeUnit);
      setSameDayCutoff(s.sameDayCutoffTime ?? "");
      setLoaded(true);
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await updateShop({
        deliveryPaymentCardOnline: paymentMethods.cardOnline,
        deliveryPaymentCashOnDelivery: paymentMethods.cashOnFulfillment,
        deliveryPaymentCardOnDelivery: paymentMethods.cardOnFulfillment,
        deliveryHours: hours,
        deliveryTimeSlotGapMinutes: timeSlotGapMinutes,
        deliveryPreparationTimeMinutes: preparationTimeMinutes,
        deliveryPreparationPlusDeliveryTimeMinutes: preparationPlusDeliveryTimeMinutes,
        estimatedDeliveryTimeFrom: estimatedFrom,
        estimatedDeliveryTimeTo: estimatedTo,
        estimatedDeliveryTimeUnit: estimatedUnit,
        sameDayCutoffTime: sameDayCutoff || null,
      });
      toast("Delivery settings saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save delivery settings", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <SettingsContentSkeleton />;

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-sm font-semibold mb-1">Delivery Settings</h3>
        <p className="text-xs text-text-faint mb-4">
          These apply to every outlet. Whether each outlet delivers, and where, is set on the outlet itself.
        </p>

        <div className="space-y-6">
          <div>
            <p className="text-sm font-medium text-text-secondary dark:text-zinc-400 mb-2">Payment Methods</p>
            <PaymentMethodsEditor context="delivery" value={paymentMethods} onChange={setPaymentMethods} />
            <p className="text-xs text-text-faint mt-2">
              Card (Paid Online) only works once a card processor is connected under{" "}
              <Link href="/integrations/payments" className="text-accent-text dark:text-accent hover:underline">
                Integrations &gt; Payments
              </Link>
              .
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-text-secondary dark:text-zinc-400 mb-2">Opening Hours for Delivery</p>
            <BusinessHoursEditor value={hours} onChange={setHours} />
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold mb-3">Operation Settings</h3>
        <div className="space-y-6">
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
              label="Preparation + Delivery Time (minutes)"
              type="number"
              min="0"
              value={preparationPlusDeliveryTimeMinutes}
              onChange={(e) => setPreparationPlusDeliveryTimeMinutes(Number(e.target.value))}
            />
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Estimated Delivery Time</h3>
            <p className="text-xs text-text-faint mb-2">
              The default shown on the order-tracking page and on a product page for any product with no
              delivery-time override of its own.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="From"
                type="number"
                min="0"
                value={estimatedFrom}
                onChange={(e) => setEstimatedFrom(Number(e.target.value))}
              />
              <Input
                label="To"
                type="number"
                min="0"
                value={estimatedTo}
                onChange={(e) => setEstimatedTo(Number(e.target.value))}
              />
              <Combobox
                label="Type"
                value={estimatedUnit}
                onChange={(value) => setEstimatedUnit(value as "minutes" | "hours" | "days")}
                options={[
                  { value: "minutes", label: "Minutes" },
                  { value: "hours", label: "Hours" },
                  { value: "days", label: "Days" },
                ]}
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Same-day order cutoff</h3>
            <p className="text-xs text-text-faint mb-2">
              Orders placed by this time (shop timezone) can be delivered the same day. Leave blank to turn off the
              &ldquo;Earliest Delivery&rdquo; estimate. Enable the display per surface under Theme &gt; Collection page / Product page.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Cutoff time"
                type="time"
                value={sameDayCutoff}
                onChange={(e) => setSameDayCutoff(e.target.value)}
              />
            </div>
          </div>
        </div>
      </Card>

      <Button variant="primary" onClick={handleSave} disabled={saving} loading={saving} className="w-fit">
        <Check className="size-4 inline -mt-0.5 me-1" />
        Save changes
      </Button>
    </div>
  );
}
