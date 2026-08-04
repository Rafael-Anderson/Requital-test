"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { getShop, updateOutlet, updateShop } from "@/lib/api";
import type { Outlet, Shop } from "@/lib/types";
import { defaultBusinessHours, mergeBusinessHours } from "@/lib/business-hours";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import Card from "@/components/ui/Card";
import Combobox from "@/components/ui/Combobox";
import BusinessHoursEditor from "@/components/BusinessHoursEditor";
import PaymentMethodsEditor, { type PaymentMethodsValue } from "@/components/PaymentMethodsEditor";
import { useToast } from "@/components/ui/Toast";

const TIME_SLOT_PRESETS = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 30, label: "30 minutes" },
  { minutes: 45, label: "45 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 90, label: "1.5 hours" },
  { minutes: 120, label: "2 hours" },
];

export default function OutletDeliveryTab({
  outlet,
  onSaved,
}: {
  outlet: Outlet;
  onSaved: () => void;
}) {
  const [deliveryEnabled, setDeliveryEnabled] = useState(outlet.deliveryEnabled);
  const [deliveryRadiusKm, setDeliveryRadiusKm] = useState(
    outlet.deliveryRadiusKm !== null ? String(outlet.deliveryRadiusKm) : "",
  );
  const [savingAvailability, setSavingAvailability] = useState(false);

  const [shop, setShop] = useState<Shop | null>(null);
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
  const [estimatedUnit, setEstimatedUnit] = useState<"minutes" | "hours">("minutes");
  const [savingBusinessSettings, setSavingBusinessSettings] = useState(false);

  const toast = useToast();

  useEffect(() => {
    getShop().then((s) => {
      setShop(s);
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
    });
  }, []);

  async function handleSaveAvailability() {
    if (deliveryEnabled && (!deliveryRadiusKm || outlet.latitude === null || outlet.longitude === null)) {
      toast("Delivery requires a radius and coordinates set on the Address tab", "error");
      return;
    }
    setSavingAvailability(true);
    try {
      await updateOutlet(outlet.id, {
        deliveryEnabled,
        deliveryRadiusKm: deliveryEnabled && deliveryRadiusKm ? Number(deliveryRadiusKm) : undefined,
      });
      toast("Delivery availability saved");
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save delivery availability", "error");
    } finally {
      setSavingAvailability(false);
    }
  }

  async function handleSaveBusinessSettings() {
    setSavingBusinessSettings(true);
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
      });
      toast("Delivery settings saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save delivery settings", "error");
    } finally {
      setSavingBusinessSettings(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-sm font-semibold mb-3">Delivery Availability</h3>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Toggle checked={deliveryEnabled} onChange={setDeliveryEnabled} />
            <span className="text-sm">Delivery available</span>
          </div>
          {deliveryEnabled && (
            <div className="pl-6 space-y-1.5">
              <Input
                label="Delivery radius (km)"
                type="number"
                min="0"
                step="0.1"
                value={deliveryRadiusKm}
                onChange={(e) => setDeliveryRadiusKm(e.target.value)}
                required
              />
              {(outlet.latitude === null || outlet.longitude === null) && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  This outlet has no coordinates yet — set them on the Address tab before saving.
                </p>
              )}
            </div>
          )}
          <Button variant="primary" onClick={handleSaveAvailability} disabled={savingAvailability}>
            <Check className="size-4 inline -mt-0.5 mr-1" />
            Save changes
          </Button>
        </div>
      </Card>

      {!shop ? (
        <p className="text-sm text-zinc-500">Loading delivery settings…</p>
      ) : (
        <>
          <div className="space-y-4">
            <Card>
              <h3 className="text-sm font-semibold mb-1">Delivery Settings</h3>
              <p className="text-xs text-zinc-400 mb-4">
                These apply shop-wide, across every outlet — not just this one.
              </p>

              <div className="space-y-6">
                <div>
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Payment Methods</p>
                  <PaymentMethodsEditor context="delivery" value={paymentMethods} onChange={setPaymentMethods} />
                </div>

                <div>
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                    Opening Hours for Delivery
                  </p>
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
                  <p className="text-xs text-zinc-400 mb-2">Shown to customers on the order-tracking page.</p>
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
                      onChange={(value) => setEstimatedUnit(value as "minutes" | "hours")}
                      options={[
                        { value: "minutes", label: "Minutes" },
                        { value: "hours", label: "Hours" },
                      ]}
                    />
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <Button variant="primary" onClick={handleSaveBusinessSettings} disabled={savingBusinessSettings}>
            <Check className="size-4 inline -mt-0.5 mr-1" />
            Save changes
          </Button>
        </>
      )}
    </div>
  );
}
