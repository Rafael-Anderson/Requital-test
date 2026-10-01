"use client";

import OrderDatesCard from "@/components/OrderDatesCard";
import PageShell from "@/components/ui/PageShell";
import ShopDeliverySettingsForm from "@/components/ShopDeliverySettingsForm";

export default function FulfilmentDeliveryPage() {
  return (
    <PageShell>
      <div className="space-y-4">
        <ShopDeliverySettingsForm />
        <OrderDatesCard />
      </div>
    </PageShell>
  );
}
