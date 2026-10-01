"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { getShop, updateOutlet } from "@/lib/api";
import type { Outlet, Shop } from "@/lib/types";
import { summarizeHours } from "@/lib/business-hours";
import Button from "@/components/ui/Button";
import Toggle from "@/components/ui/Toggle";
import Card from "@/components/ui/Card";
import OutletDeliveryAreaTab from "@/components/OutletDeliveryAreaTab";
import ShopWideSummary, { paymentMethodsSummary } from "@/components/ShopWideSummary";
import { useToast } from "@/components/ui/Toast";

export default function OutletDeliveryTab({
  outlet,
  onSaved,
}: {
  outlet: Outlet;
  onSaved: () => void;
}) {
  const [deliveryEnabled, setDeliveryEnabled] = useState(outlet.deliveryEnabled);
  const [savingAvailability, setSavingAvailability] = useState(false);

  const [shop, setShop] = useState<Shop | null>(null);
  const toast = useToast();

  useEffect(() => {
    getShop().then(setShop);
  }, []);

  async function handleSaveAvailability() {
    setSavingAvailability(true);
    try {
      await updateOutlet(outlet.id, { deliveryEnabled });
      toast("Delivery availability saved");
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save delivery availability", "error");
    } finally {
      setSavingAvailability(false);
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
          <Button variant="primary" onClick={handleSaveAvailability} disabled={savingAvailability}>
            <Check className="size-4 inline -mt-0.5 me-1" />
            Save changes
          </Button>
        </div>
      </Card>

      <OutletDeliveryAreaTab outletId={outlet.id} />

      {shop && (
        <ShopWideSummary
          title="Delivery Settings"
          rows={[
            { label: "Payment methods", value: paymentMethodsSummary(shop.deliveryPaymentCardOnline, shop.deliveryPaymentCashOnDelivery, shop.deliveryPaymentCardOnDelivery, "Cash on Delivery", "Card on Delivery") },
            { label: "Opening hours", value: summarizeHours(shop.deliveryHours) },
            { label: "Time slot gap", value: `${shop.deliveryTimeSlotGapMinutes} min` },
            { label: "Preparation time", value: `${shop.deliveryPreparationTimeMinutes} min` },
            { label: "Preparation + delivery time", value: `${shop.deliveryPreparationPlusDeliveryTimeMinutes} min` },
            { label: "Estimated delivery time", value: `${shop.estimatedDeliveryTimeFrom} to ${shop.estimatedDeliveryTimeTo} ${shop.estimatedDeliveryTimeUnit}` },
            { label: "Same-day cutoff", value: shop.sameDayCutoffTime ?? "Off" },
          ]}
          links={[{ href: "/settings/fulfilment/delivery", label: "Change for all outlets" }]}
        />
      )}
    </div>
  );
}
