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

export default function OutletPickupTab({
  outlet,
  onSaved,
}: {
  outlet: Outlet;
  onSaved: () => void;
}) {
  const [pickupEnabled, setPickupEnabled] = useState(outlet.pickupEnabled);
  const [savingAvailability, setSavingAvailability] = useState(false);

  const [shop, setShop] = useState<Shop | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodsValue>({
    cardOnline: true,
    cashOnFulfillment: true,
    cardOnFulfillment: false,
  });
  const [hours, setHours] = useState(defaultBusinessHours());
  const [timeSlotGapMinutes, setTimeSlotGapMinutes] = useState(30);
  const [preparationTimeMinutes, setPreparationTimeMinutes] = useState(15);
  const [preparationPlusTimeMinutes, setPreparationPlusTimeMinutes] = useState(30);
  const [savingBusinessSettings, setSavingBusinessSettings] = useState(false);

  const toast = useToast();

  useEffect(() => {
    getShop().then((s) => {
      setShop(s);
      setPaymentMethods({
        cardOnline: s.pickupPaymentCardOnline,
        cashOnFulfillment: s.pickupPaymentCashOnPickup,
        cardOnFulfillment: s.pickupPaymentCardOnPickup,
      });
      setHours(mergeBusinessHours(s.pickupHours));
      setTimeSlotGapMinutes(s.pickupTimeSlotGapMinutes);
      setPreparationTimeMinutes(s.pickupPreparationTimeMinutes);
      setPreparationPlusTimeMinutes(s.pickupPreparationPlusTimeMinutes);
    });
  }, []);

  async function handleSaveAvailability() {
    setSavingAvailability(true);
    try {
      await updateOutlet(outlet.id, { pickupEnabled });
      toast("Pickup availability saved");
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save pickup availability", "error");
    } finally {
      setSavingAvailability(false);
    }
  }

  async function handleSaveBusinessSettings() {
    setSavingBusinessSettings(true);
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
      setSavingBusinessSettings(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-sm font-semibold mb-3">Pickup Availability</h3>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Toggle checked={pickupEnabled} onChange={setPickupEnabled} />
            <span className="text-sm">Pickup available</span>
          </div>
          <Button variant="primary" onClick={handleSaveAvailability} disabled={savingAvailability}>
            <Check className="size-4 inline -mt-0.5 mr-1" />
            Save changes
          </Button>
        </div>
      </Card>

      {!shop ? (
        <p className="text-sm text-zinc-500">Loading pickup settings…</p>
      ) : (
        <>
          <div className="space-y-4">
            <Card>
              <h3 className="text-sm font-semibold mb-1">Pickup Settings</h3>
              <p className="text-xs text-zinc-400 mb-4">
                These apply shop-wide, across every outlet — not just this one.
              </p>

              <div className="space-y-6">
                <div>
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Payment Methods</p>
                  <PaymentMethodsEditor context="pickup" value={paymentMethods} onChange={setPaymentMethods} />
                </div>

                <div>
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                    Opening Hours for Pickup
                  </p>
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
