"use client";

import { useState } from "react";
import { cancelSliderDelivery, dispatchSliderDelivery, getSliderQuote } from "@/lib/api";
import type { Order, SliderQuote, SliderVehicleType } from "@/lib/types";
import { waLink } from "@/lib/validators";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import StatusBadge from "@/components/StatusBadge";
import { useToast } from "@/components/ui/Toast";

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
  const [quote, setQuote] = useState<SliderQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [vehicleType, setVehicleType] = useState<SliderVehicleType>("any");
  const [dispatching, setDispatching] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const delivery = order.externaldelivery;
  // Manual courier logging already owns this order's one delivery slot —
  // Slider dispatch isn't offered on top of it (the backend's own
  // one-record-per-order unique constraint would reject it anyway).
  if (delivery && delivery.provider !== "slider") return null;

  async function handleGetQuote() {
    setQuoting(true);
    try {
      setQuote(await getSliderQuote(order.id));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to get a Slider quote", "error");
    } finally {
      setQuoting(false);
    }
  }

  async function handleDispatch() {
    setDispatching(true);
    try {
      await dispatchSliderDelivery(order.id, { vehicleType });
      toast("Sent to Slider");
      setQuote(null);
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to dispatch to Slider", "error");
    } finally {
      setDispatching(false);
    }
  }

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

  if (quote) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-text-muted">
          {quote.distanceKm.toFixed(1)} km · ~{quote.durationMinutes} min
        </p>
        <Select value={vehicleType} onChange={(e) => setVehicleType(e.target.value as SliderVehicleType)}>
          {quote.vehicles
            .filter((v) => v.vehicleType !== "any")
            .map((v) => (
              <option key={v.vehicleType} value={v.vehicleType} disabled={!v.isAvailable}>
                {v.vehicleType} — {v.deliveryFee.toFixed(2)} AED
                {!v.isAvailable ? ` (${v.unavailableReason ?? "unavailable"})` : ""}
              </option>
            ))}
          <option value="any">any (recommended — Slider optimises)</option>
        </Select>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setQuote(null)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleDispatch} disabled={dispatching} loading={dispatching}>
            {dispatching ? "Sending…" : "Confirm & send"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button variant="secondary" size="sm" onClick={handleGetQuote} disabled={quoting} loading={quoting}>
      {quoting ? "Getting quote…" : "Send to Slider"}
    </Button>
  );
}
