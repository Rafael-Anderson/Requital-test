"use client";

import { useEffect, useState } from "react";
import { cancelSliderDelivery, getSliderSettings } from "@/lib/api";
import type { Order, SliderSettings } from "@/lib/types";
import { waLink } from "@/lib/validators";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import ManageDeliveryModal from "@/components/ManageDeliveryModal";

const TERMINAL_STATUSES = ["delivered", "cancelled"];

// Shared across all 3 order-detail surfaces (OrderDetailModal,
// SimpleOrderDetailModal, orders/[id]/page.tsx) rather than three copies —
// same "one shared component, thread props down" approach this app already
// uses for pieces like OrderReturnsSection/OrderNotesSection. `compact`
// trims the driver/tracking rows to a single line for SimpleOrderDetailModal,
// which otherwise deliberately excludes the external-delivery section
// entirely (see that file's own doc comment) — Slider dispatch is still
// offered there per the integration spec's explicit "all three order detail
// views" requirement, just kept minimal.
export default function SliderDeliveryPanel({
  order,
  onChanged,
  compact = false,
}: {
  order: Order;
  onChanged: () => void;
  compact?: boolean;
}) {
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [sliderStatus, setSliderStatus] = useState<SliderSettings["status"] | null>(null);

  const delivery = order.externaldelivery;
  const alreadyDispatchedViaSlider = delivery?.provider === "slider";

  // Only relevant for the "offer to dispatch" path below — an order already
  // dispatched via Slider always shows its real status regardless of the
  // shop's current toggle (a merchant can disable Slider after dispatching
  // an in-flight delivery; that delivery still needs to be trackable/
  // cancellable). Skipped entirely once already dispatched, so this never
  // fires an extra fetch for the common case of viewing a Slider order.
  useEffect(() => {
    if (alreadyDispatchedViaSlider) return;
    getSliderSettings()
      .then((s) => setSliderStatus(s.status))
      .catch(() => setSliderStatus("not_enabled"));
  }, [alreadyDispatchedViaSlider]);

  // Manual courier logging already owns this order's one delivery slot —
  // Slider dispatch isn't offered on top of it (the backend's own
  // one-record-per-order unique constraint would reject it anyway).
  if (delivery && delivery.provider !== "slider") return null;

  async function handleCancel() {
    if (!confirm("Cancel this Slider delivery?")) return;
    setCancelling(true);
    try {
      await cancelSliderDelivery(order.id);
      toast("Slider delivery cancelled");
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to cancel the Slider delivery", "error");
    } finally {
      setCancelling(false);
    }
  }

  if (delivery?.provider === "slider") {
    const canCancel = !TERMINAL_STATUSES.includes(delivery.status);
    return (
      <div className={compact ? "space-y-1" : "space-y-1.5"}>
        <div className="flex justify-between items-center text-sm">
          <span className="text-text-muted">Slider</span>
          <StatusBadge status={delivery.status} />
        </div>
        {!compact && delivery.driverName && (
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Driver</span>
            {delivery.driverPhone ? (
              <a
                href={waLink(delivery.driverPhone)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent-text dark:hover:text-accent hover:underline"
              >
                {delivery.driverName}
              </a>
            ) : (
              <span>{delivery.driverName}</span>
            )}
          </div>
        )}
        {!compact && delivery.trackingUrl && (
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Tracking</span>
            <a
              href={delivery.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-text dark:text-accent hover:underline"
            >
              Track delivery
            </a>
          </div>
        )}
        {canCancel && (
          <div className="flex justify-end pt-1">
            <Button variant="danger" size="sm" onClick={handleCancel} disabled={cancelling} loading={cancelling}>
              Cancel Slider delivery
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Loading (null) or the shop never turned Slider on — render nothing
  // rather than flashing a "Send to Slider" button that would just 400.
  if (sliderStatus === null || sliderStatus === "not_enabled") return null;

  if (sliderStatus === "awaiting_setup") {
    return (
      <p className="text-xs text-text-faint">
        Your Slider account is being set up. Delivery dispatch will be available once complete.
      </p>
    );
  }

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>
        Manage Delivery
      </Button>
      {modalOpen && (
        <ManageDeliveryModal order={order} onClose={() => setModalOpen(false)} onChanged={onChanged} />
      )}
    </>
  );
}
