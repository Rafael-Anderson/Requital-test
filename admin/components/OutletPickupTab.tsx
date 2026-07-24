"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { getShop, updateOutlet, updateShop } from "@/lib/api";
import type { Outlet, Shop } from "@/lib/types";
import { defaultBusinessHours, mergeBusinessHours } from "@/lib/business-hours";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Checkbox from "@/components/ui/Checkbox";
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

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
    <div className="max-w-xl space-y-8">
      <div>
        <h3 className="text-sm font-semibold mb-3">Pickup Availability</h3>
        <div className="space-y-4">
          <Checkbox
            label="Pickup available"
            checked={pickupEnabled}
            onChange={(e) => setPickupEnabled(e.target.checked)}
          />
          <Button variant="primary" onClick={handleSaveAvailability} disabled={savingAvailability}>
            <Check className="size-4 inline -mt-0.5 mr-1" />
            Save changes
          </Button>
        </div>
      </div>

      <hr className="border-black/10 dark:border-white/10" />

      {!shop ? (
        <p className="text-sm text-zinc-500">Loading pickup settings…</p>
      ) : (
        <div>
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

            <div>
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                Preparation Time Settings
              </p>
              <div className="space-y-3">
                <Field label="Time Slot Gap">
                  <select
                    value={timeSlotGapMinutes}
                    onChange={(e) => setTimeSlotGapMinutes(Number(e.target.value))}
                    className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-black/40 dark:focus:border-white/40 focus:ring-[3px] focus:ring-black/10 dark:focus:ring-white/15"
                  >
                    {TIME_SLOT_PRESETS.map((p) => (
                      <option key={p.minutes} value={p.minutes}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
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
            </div>

            <Button variant="primary" onClick={handleSaveBusinessSettings} disabled={savingBusinessSettings}>
              <Check className="size-4 inline -mt-0.5 mr-1" />
              Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
