"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getOutlet, updateOutlet } from "@/lib/api";
import type { Outlet } from "@/lib/types";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import OutletEditSidebar, { type OutletEditTab } from "@/components/OutletEditSidebar";
import OutletBasicInfoTab from "@/components/OutletBasicInfoTab";
import OutletAddressTab from "@/components/OutletAddressTab";
import OutletDeliveryTab from "@/components/OutletDeliveryTab";
import OutletDeliveryAreaTab from "@/components/OutletDeliveryAreaTab";
import OutletPickupTab from "@/components/OutletPickupTab";
import OutletQrTab from "@/components/OutletQrTab";
import PageShell from "@/components/ui/PageShell";

export default function EditOutletPage() {
  const params = useParams<{ outletId: string }>();
  const outletId = Number(params.outletId);

  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<OutletEditTab>("basic");
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      setOutlet(await getOutlet(outletId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load outlet");
    }
  }, [outletId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleToggleActive() {
    if (!outlet) return;
    const nextActive = !outlet.active;
    setOutlet({ ...outlet, active: nextActive });
    try {
      await updateOutlet(outlet.id, { active: nextActive });
      toast(nextActive ? "Outlet activated" : "Outlet deactivated");
    } catch (err) {
      setOutlet(outlet); // revert on failure
      toast(err instanceof Error ? err.message : "Failed to update outlet status", "error");
    }
  }

  return (
    <PageShell>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {!outlet && !error ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : outlet ? (
        <>
          <h1 className="text-2xl font-semibold mb-6">Edit &quot;{outlet.name}&quot;</h1>
          <div className="flex gap-8 flex-col sm:flex-row">
            <OutletEditSidebar
              active={activeTab}
              onSelect={setActiveTab}
              outletActive={outlet.active}
              onToggleActive={handleToggleActive}
            />
            <div className="flex-1 min-w-0">
              {activeTab === "basic" && <OutletBasicInfoTab outlet={outlet} onSaved={refresh} />}
              {activeTab === "address" && <OutletAddressTab outlet={outlet} onSaved={refresh} />}
              {activeTab === "delivery" && <OutletDeliveryTab outlet={outlet} onSaved={refresh} />}
              {activeTab === "deliveryArea" && <OutletDeliveryAreaTab outletId={outlet.id} />}
              {activeTab === "pickup" && <OutletPickupTab outlet={outlet} onSaved={refresh} />}
              {activeTab === "qr" && <OutletQrTab outlet={outlet} />}
            </div>
          </div>
        </>
      ) : null}
    </PageShell>
  );
}
