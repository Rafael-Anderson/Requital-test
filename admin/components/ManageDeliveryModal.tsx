"use client";

// "External Delivery" modal — the merchant-facing flow for quoting and
// dispatching a courier for one order. Slider is the only real integration
// today (backend/src/delivery-providers/), but the Delivery Company picker
// is structured as a list from the start (see DELIVERY_COMPANIES below) so a
// second courier (SHP-9, see docs/plans/product-capability-audit*.md) only
// needs a new branch here, not a rewrite. Reuses the existing, already-
// tested backend endpoints (getSliderQuote/dispatchSliderDelivery from
// lib/api.ts) — no new backend work.
import { useState } from "react";
import { dispatchSliderDelivery, getSliderQuote } from "@/lib/api";
import type { Order, SliderQuote, SliderVehicleType } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import DateTimePicker, { formatDateTimeDisplay } from "@/components/ui/DateTimePicker";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import { useToast } from "@/components/ui/Toast";

type CompanyId = "slider";

const DELIVERY_COMPANIES: { id: CompanyId; label: string }[] = [{ id: "slider", label: "Slider" }];

const VEHICLE_TYPES_BY_COMPANY: Record<CompanyId, { value: SliderVehicleType; label: string }[]> = {
  slider: [
    { value: "bike", label: "Bike" },
    { value: "car", label: "Car" },
  ],
};

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hrs = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hrs} hr ${rem} min` : `${hrs} hr`;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  card_online: "Card (Paid Online)",
  cash_on_delivery: "Cash (Pay on Delivery)",
  card_on_delivery: "Card (Pay on Delivery)",
  cash_on_pickup: "Cash (Pay on Pickup)",
  card_on_pickup: "Card (Pay on Pickup)",
  paypal: "PayPal (Paid Online)",
  tabby: "Tabby (Paid Online)",
  tamara: "Tamara (Paid Online)",
};
const ONLINE_PAID_METHODS = new Set(["card_online", "paypal", "tabby", "tamara"]);

export function paymentModeLabel(order: Order): { label: string; gatewaySubline: string | null } {
  const method = order.paymentMethod ?? "";
  const label = PAYMENT_METHOD_LABELS[method] ?? (method ? method.replace(/_/g, " ") : "Unknown");
  const gateway = order.paymenttransaction?.[0]?.gateway;
  const gatewaySubline = ONLINE_PAID_METHODS.has(method) && gateway ? `Paid via ${gateway}` : null;
  return { label, gatewaySubline };
}

function formatDeliveryAddress(order: Order): string {
  return [order.customerAddress, order.area, order.emirate].filter(Boolean).join(", ");
}

export default function ManageDeliveryModal({
  order,
  onClose,
  onChanged,
}: {
  order: Order;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [companyId, setCompanyId] = useState<CompanyId | "">("");
  const [vehicleType, setVehicleType] = useState<SliderVehicleType>("bike");
  const [quote, setQuote] = useState<SliderQuote | null>(null);
  const [quotedAt, setQuotedAt] = useState<Date | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [deliveryType, setDeliveryType] = useState<"immediate" | "schedule">("immediate");
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  function handleCompanyChange(value: string) {
    const id = value as CompanyId | "";
    setCompanyId(id);
    setVehicleType(id ? VEHICLE_TYPES_BY_COMPANY[id][0].value : "bike");
    setQuote(null);
    setQuotedAt(null);
    setQuoteError(null);
    setDeliveryType("immediate");
    setScheduleAt(null);
    setDispatchError(null);
  }

  async function handleCalculate() {
    setQuoting(true);
    setQuoteError(null);
    setDispatchError(null);
    try {
      const result = await getSliderQuote(order.id);
      setQuote(result);
      setQuotedAt(new Date());
    } catch (err) {
      setQuoteError(err instanceof Error ? err.message : "Failed to get a quote");
    } finally {
      setQuoting(false);
    }
  }

  async function handleCreateDelivery() {
    setDispatching(true);
    setDispatchError(null);
    try {
      await dispatchSliderDelivery(order.id, {
        vehicleType,
        scheduleAt: deliveryType === "schedule" && scheduleAt ? scheduleAt : undefined,
      });
      toast("Delivery created");
      onChanged();
      onClose();
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : "Failed to create the delivery");
    } finally {
      setDispatching(false);
    }
  }

  const selectedVehicle = quote?.vehicles.find((v) => v.vehicleType === vehicleType) ?? null;
  const pickupTime = deliveryType === "schedule" && scheduleAt ? new Date(scheduleAt) : quotedAt;
  const customerDelivery =
    pickupTime && quote ? new Date(pickupTime.getTime() + quote.durationMinutes * 60_000) : null;
  const payment = paymentModeLabel(order);

  const canCreate =
    !!quote && !!selectedVehicle?.isAvailable && !dispatching && !(deliveryType === "schedule" && !scheduleAt);

  return (
    <Modal title="External Delivery" onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Delivery Company" value={companyId} onChange={(e) => handleCompanyChange(e.target.value)}>
            <option value="">Select company…</option>
            {DELIVERY_COMPANIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>

          {companyId && (
            <>
              <Select
                label="Vehicle Type"
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value as SliderVehicleType)}
              >
                {VEHICLE_TYPES_BY_COMPANY[companyId].map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </Select>

              <Button
                variant="primary"
                onClick={handleCalculate}
                disabled={quoting}
                loading={quoting}
                className={quoting ? "btn-pulse" : ""}
              >
                {quoting ? "Calculating…" : "Calculate"}
              </Button>
            </>
          )}
        </div>

        {quoteError && <InlineErrorMessage>{quoteError}</InlineErrorMessage>}

        {quote && selectedVehicle && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-6 rounded-lg border border-border dark:border-white/10 p-4">
              <div>
                <div className="text-xs text-text-muted">Company</div>
                <div className="text-sm font-medium">Slider</div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Vehicle</div>
                <div className="text-sm font-medium capitalize">{vehicleType}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted">ETA</div>
                <div className="text-sm font-medium">{formatDuration(quote.durationMinutes)}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Charge</div>
                <div className="text-sm font-bold text-success dark:text-green-400">
                  {selectedVehicle.deliveryFee.toFixed(2)} AED
                </div>
              </div>
            </div>

            {!selectedVehicle.isAvailable && (
              <InlineErrorMessage>
                {vehicleType} unavailable{selectedVehicle.unavailableReason ? `: ${selectedVehicle.unavailableReason}` : ""}
              </InlineErrorMessage>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <section className="border border-gray-200 rounded-lg p-4 dark:border-white/10 space-y-1.5">
                <h3 className="font-medium mb-2">Customer &amp; Order Details</h3>
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Customer Name</span>
                  <span className="text-right">{order.customerName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Phone</span>
                  <span className="text-right">{order.customerPhone}</span>
                </div>
                <div className="flex justify-between text-sm gap-4">
                  <span className="text-text-muted shrink-0">Delivery Address</span>
                  <span className="text-right">{formatDeliveryAddress(order)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Order Ref</span>
                  <span className="text-right">#{order.id}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Payment Mode</span>
                  <div className="text-right">
                    <div>{payment.label}</div>
                    {payment.gatewaySubline && <div className="text-xs text-text-faint">{payment.gatewaySubline}</div>}
                  </div>
                </div>
              </section>

              <section className="border border-gray-200 rounded-lg p-4 dark:border-white/10 space-y-1.5">
                <h3 className="font-medium mb-2">Delivery Information</h3>
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Pickup Time</span>
                  <span className="text-right">
                    {deliveryType === "schedule" && pickupTime ? formatDateTimeDisplay(pickupTime) : "Now"}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Customer Delivery</span>
                  <span className="text-right">{customerDelivery ? formatDateTimeDisplay(customerDelivery) : "—"}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Total ETA</span>
                  <span className="text-right">{formatDuration(quote.durationMinutes)}</span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-text-muted text-sm">Delivery Total Charge</span>
                  <span className="rounded-full bg-accent-tint text-accent-text text-sm font-bold px-3 py-1">
                    {selectedVehicle.deliveryFee.toFixed(2)} AED
                  </span>
                </div>
              </section>
            </div>

            <div>
              <div className="text-[13px] font-medium text-text-secondary dark:text-zinc-400 mb-1.5">Delivery Type</div>
              <SegmentedToggle
                value={deliveryType}
                onChange={setDeliveryType}
                options={[
                  { value: "immediate", label: "Immediate Delivery" },
                  { value: "schedule", label: "Schedule Delivery" },
                ]}
              />
            </div>

            {deliveryType === "schedule" && (
              <DateTimePicker label="Scheduled for" value={scheduleAt} onChange={setScheduleAt} />
            )}

            {dispatchError && <InlineErrorMessage>{dispatchError}</InlineErrorMessage>}

            <div className="flex justify-end">
              <Button variant="primary" onClick={handleCreateDelivery} disabled={!canCreate} loading={dispatching}>
                {dispatching ? "Creating…" : "Create Delivery"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
