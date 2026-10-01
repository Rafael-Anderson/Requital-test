"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { getShop, updateOutlet } from "@/lib/api";
import type { Outlet, Shop } from "@/lib/types";
import { summarizeHours } from "@/lib/business-hours";
import Button from "@/components/ui/Button";
import Toggle from "@/components/ui/Toggle";
import Card from "@/components/ui/Card";
import ShopWideSummary, { paymentMethodsSummary } from "@/components/ShopWideSummary";
import { useToast } from "@/components/ui/Toast";

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
  const toast = useToast();

  useEffect(() => {
    getShop().then(setShop);
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
            <Check className="size-4 inline -mt-0.5 me-1" />
            Save changes
          </Button>
        </div>
      </Card>

      {shop && (
        <ShopWideSummary
          title="Pickup Settings"
          rows={[
            { label: "Payment methods", value: paymentMethodsSummary(shop.pickupPaymentCardOnline, shop.pickupPaymentCashOnPickup, shop.pickupPaymentCardOnPickup, "Cash on Pickup", "Card on Pickup") },
            { label: "Opening hours", value: summarizeHours(shop.pickupHours) },
            { label: "Time slot gap", value: `${shop.pickupTimeSlotGapMinutes} min` },
            { label: "Preparation time", value: `${shop.pickupPreparationTimeMinutes} min` },
            { label: "Preparation + pickup time", value: `${shop.pickupPreparationPlusTimeMinutes} min` },
          ]}
          links={[{ href: "/settings/fulfilment/pickup", label: "Change for all outlets" }]}
        />
      )}
    </div>
  );
}
