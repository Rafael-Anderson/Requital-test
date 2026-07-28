"use client";

import { useEffect, useState } from "react";
import { Pencil, X } from "lucide-react";
import {
  cancelOrder,
  createExternalDelivery,
  getOrder,
  getShop,
  updateExternalDelivery,
  updateOrderDeliveryFee,
  updateOrderStatus,
} from "@/lib/api";
import { getNextAction, type ExternalDelivery, type Order } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import StatusBadge from "@/components/StatusBadge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Skeleton from "@/components/ui/Skeleton";
import Thumbnail from "@/components/ui/Thumbnail";
import { useToast } from "@/components/ui/Toast";
import OrderNotesSection from "@/components/OrderNotesSection";
import OrderReturnsSection from "@/components/OrderReturnsSection";
import EditOrderItemsModal from "@/components/EditOrderItemsModal";

const EXTERNAL_DELIVERY_STATUSES: ExternalDelivery["status"][] = ["pending", "picked_up", "delivered", "failed"];
// Matches backend EDITABLE_ORDER_STATUSES — items can only be changed before
// staff start physically preparing the order.
const EDITABLE_ITEM_STATUSES = ["pending", "confirmed"];

export default function OrderDetailModal({
  orderId,
  onClose,
  onChanged,
}: {
  orderId: number | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { user } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taxDisplayText, setTaxDisplayText] = useState<string | null>(null);
  const [editingFee, setEditingFee] = useState(false);
  const [feeInput, setFeeInput] = useState("");
  const [savingFee, setSavingFee] = useState(false);
  const [loggingDelivery, setLoggingDelivery] = useState(false);
  const [carrier, setCarrier] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [destination, setDestination] = useState("");
  const [savingDelivery, setSavingDelivery] = useState(false);
  const [editingItems, setEditingItems] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (orderId === null) return;
    setOrder(null);
    setError(null);
    getOrder(orderId)
      .then(setOrder)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load order"));
  }, [orderId]);

  // Fetched once per mount rather than per order — the tax caption is a
  // shop-wide setting, not order data.
  useEffect(() => {
    getShop()
      .then((s) => setTaxDisplayText(s.taxDisplayText))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (orderId === null) return;
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [orderId, onClose]);

  if (orderId === null) return null;

  async function refetch() {
    try {
      setOrder(await getOrder(orderId!));
      onChanged?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to refresh order", "error");
    }
  }

  async function handleAdvance() {
    if (!order) return;
    const action = getNextAction(order.status);
    if (!action) return;
    try {
      await updateOrderStatus(order.id, action.next);
      toast(`Order #${order.id} moved to ${action.next.replace(/_/g, " ")}`);
      refetch();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update status", "error");
    }
  }

  async function handleCancel() {
    if (!order) return;
    if (!confirm(`Cancel order #${order.id}? Any decremented stock will be restored.`)) return;
    try {
      await cancelOrder(order.id);
      toast(`Order #${order.id} cancelled`);
      refetch();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to cancel order", "error");
    }
  }

  async function handleSaveFee() {
    if (!order) return;
    const value = Number(feeInput);
    if (Number.isNaN(value) || value < 0) {
      toast("Enter a valid delivery fee", "error");
      return;
    }
    setSavingFee(true);
    try {
      await updateOrderDeliveryFee(order.id, value);
      toast("Delivery fee updated");
      setEditingFee(false);
      refetch();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update delivery fee", "error");
    } finally {
      setSavingFee(false);
    }
  }

  async function handleLogDelivery() {
    if (!order) return;
    const price = Number(priceInput);
    if (!carrier.trim() || !destination.trim() || Number.isNaN(price) || price < 0) {
      toast("Enter a carrier, destination, and valid price", "error");
      return;
    }
    setSavingDelivery(true);
    try {
      await createExternalDelivery(order.id, {
        carrier: carrier.trim(),
        vehicleType: vehicleType.trim() || undefined,
        price,
        destination: destination.trim(),
      });
      toast("External delivery logged");
      setLoggingDelivery(false);
      refetch();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to log external delivery", "error");
    } finally {
      setSavingDelivery(false);
    }
  }

  async function handleUpdateDeliveryStatus(status: ExternalDelivery["status"]) {
    if (!order) return;
    try {
      await updateExternalDelivery(order.id, { status });
      toast("Delivery status updated");
      refetch();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update delivery status", "error");
    }
  }

  const nextAction = order ? getNextAction(order.status) : null;
  const canCancel = order && order.status !== "delivered" && order.status !== "cancelled";
  // Same fulfillment cutoff as cancellation — matches the backend guard.
  const canEditFee = order && order.status !== "delivered" && order.status !== "cancelled";
  const latestTxn = order?.paymenttransaction?.[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-zinc-900 border dark:border-white/10 p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        {!order ? (
          <div className="space-y-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap mb-1 pr-8">
              <h2 className="text-xl font-semibold">Order #{order.id}</h2>
              <StatusBadge status={order.status} />
            </div>
            <div className="flex items-center gap-4 flex-wrap text-sm text-zinc-500 mb-6">
              <span>Placed {relativeTime(order.createdAt)}</span>
              {order.deliveryDate && (
                <span>
                  Delivery {new Date(order.deliveryDate).toLocaleDateString()}
                  {order.deliveryTimeSlot ? ` · ${order.deliveryTimeSlot}` : ""}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-4">
                <section className="border rounded-lg p-4 dark:border-white/10">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium">Order items</h3>
                    {EDITABLE_ITEM_STATUSES.includes(order.status) && (
                      <Button variant="secondary" size="sm" onClick={() => setEditingItems(true)}>
                        Edit items
                      </Button>
                    )}
                  </div>
                  <div className="space-y-3">
                    {order.orderitem.map((item) => (
                      <div key={item.id} className="flex items-center gap-3">
                        <Thumbnail src={item.product?.thumbnail} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {item.productName}
                            {item.variantLabel ? ` — ${item.variantLabel}` : ""}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {item.quantity} × {item.priceAtPurchase} AED
                          </div>
                        </div>
                        <div className="text-sm font-medium">
                          {(Number(item.priceAtPurchase) * item.quantity).toFixed(2)} AED
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="border rounded-lg p-4 dark:border-white/10">
                  <h3 className="font-medium mb-3">Order summary</h3>
                  {(() => {
                    const subtotal = order.orderitem.reduce(
                      (sum, i) => sum + Number(i.priceAtPurchase) * i.quantity,
                      0,
                    );
                    // Orders created before this field existed have no
                    // stored value — fall back to deriving it from the
                    // total for those only.
                    const deliveryFee =
                      order.deliveryFee !== null ? Number(order.deliveryFee) : Number(order.total) - subtotal;
                    return (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-zinc-500">Subtotal</span>
                          <span>{subtotal.toFixed(2)} AED</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-zinc-500">Delivery fee</span>
                          {editingFee ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                autoFocus
                                value={feeInput}
                                onChange={(e) => setFeeInput(e.target.value)}
                                className="h-7 w-24 rounded-md border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-2 text-sm text-right outline-none focus:border-accent"
                              />
                              <button
                                onClick={handleSaveFee}
                                disabled={savingFee}
                                className="text-xs underline decoration-transparent hover:decoration-current disabled:opacity-40"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingFee(false)}
                                className="text-xs text-zinc-400 underline decoration-transparent hover:decoration-current"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <span className="flex items-center gap-1.5">
                              {deliveryFee.toFixed(2)} AED
                              {canEditFee && (
                                <button
                                  onClick={() => {
                                    setFeeInput(deliveryFee.toFixed(2));
                                    setEditingFee(true);
                                  }}
                                  className="text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                                  aria-label="Edit delivery fee"
                                >
                                  <Pencil className="size-3" />
                                </button>
                              )}
                            </span>
                          )}
                        </div>
                        <div className="flex justify-between text-sm font-medium border-t dark:border-white/10 mt-2 pt-2">
                          <span>Total</span>
                          <span>{order.total} AED</span>
                        </div>
                        {taxDisplayText && (
                          <p className="text-xs text-zinc-400 mt-1 text-right">{taxDisplayText}</p>
                        )}
                      </>
                    );
                  })()}
                </section>

                {order.receiverMessage && (
                  <section className="border rounded-lg p-4 dark:border-white/10">
                    <h3 className="font-medium mb-2">Receiver / greeting message</h3>
                    <p className="text-sm whitespace-pre-wrap">{order.receiverMessage}</p>
                  </section>
                )}

                <OrderReturnsSection order={order} onChanged={refetch} />

                <OrderNotesSection
                  orderId={order.id}
                  notes={order.ordernote ?? []}
                  onAdded={() => getOrder(order.id).then(setOrder)}
                />
              </div>

              <div className="space-y-4">
                <section className="border rounded-lg p-4 dark:border-white/10">
                  <h3 className="font-medium mb-3">Order info</h3>
                  <div className="space-y-2">
                    {order.orderType && (
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-500">Type</span>
                        <span className="font-medium capitalize">{order.orderType}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-start text-sm">
                      <span className="text-zinc-500">Payment</span>
                      <div className="text-right">
                        <StatusBadge status={order.paymentStatus} />
                        {latestTxn && (
                          <div className="text-xs text-zinc-500 mt-1 capitalize">
                            via {latestTxn.gateway}
                          </div>
                        )}
                      </div>
                    </div>
                    {order.channel && (
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-500">Channel</span>
                        <span className="font-medium">{order.channel}</span>
                      </div>
                    )}
                  </div>
                </section>

                <section className="border rounded-lg p-4 dark:border-white/10">
                  <h3 className="font-medium mb-2">Customer</h3>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{order.customerName}</span>
                    {order.customerOrderCount !== undefined && (
                      <span className="text-xs font-medium bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400 rounded-full px-2 py-0.5 whitespace-nowrap">
                        Ordered {order.customerOrderCount}{" "}
                        {order.customerOrderCount === 1 ? "time" : "times"}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-zinc-500 mt-1">{order.customerPhone}</p>
                  {order.customerEmail && (
                    <p className="text-sm text-zinc-500">{order.customerEmail}</p>
                  )}
                </section>

                <section className="border rounded-lg p-4 dark:border-white/10">
                  <h3 className="font-medium mb-2">Delivery address</h3>
                  <p className="text-sm">{order.customerAddress}</p>
                  <p className="text-sm text-zinc-500">
                    {order.area ? `${order.area}, ` : ""}
                    {order.emirate}
                  </p>
                  {order.deliveryNotes && (
                    <p className="text-sm text-zinc-500 mt-2">
                      <span className="text-zinc-400">Notes: </span>
                      {order.deliveryNotes}
                    </p>
                  )}
                </section>

                <section className="border rounded-lg p-4 dark:border-white/10">
                  <h3 className="font-medium mb-2">External delivery</h3>
                  {order.externaldelivery ? (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-500">Carrier</span>
                        <span className="font-medium">{order.externaldelivery.carrier}</span>
                      </div>
                      {order.externaldelivery.vehicleType && (
                        <div className="flex justify-between text-sm">
                          <span className="text-zinc-500">Vehicle</span>
                          <span>{order.externaldelivery.vehicleType}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-500">Destination</span>
                        <span className="text-right">{order.externaldelivery.destination}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-500">Paid to carrier</span>
                        <span>{order.externaldelivery.price} AED</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-zinc-500">Status</span>
                        {user?.role === "admin" ? (
                          <select
                            value={order.externaldelivery.status}
                            onChange={(e) => handleUpdateDeliveryStatus(e.target.value as ExternalDelivery["status"])}
                            className="h-7 rounded-md border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-1.5 text-xs outline-none cursor-pointer focus:border-accent capitalize"
                          >
                            {EXTERNAL_DELIVERY_STATUSES.map((s) => (
                              <option key={s} value={s} className="capitalize">
                                {s.replace(/_/g, " ")}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <StatusBadge status={order.externaldelivery.status} />
                        )}
                      </div>
                    </div>
                  ) : user?.role === "admin" ? (
                    loggingDelivery ? (
                      <div className="space-y-2.5">
                        <Input label="Carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
                        <Input
                          label="Vehicle type (optional)"
                          value={vehicleType}
                          onChange={(e) => setVehicleType(e.target.value)}
                        />
                        <Input
                          label="Price paid to carrier"
                          type="number"
                          min="0"
                          step="0.01"
                          value={priceInput}
                          onChange={(e) => setPriceInput(e.target.value)}
                        />
                        <Input label="Destination" value={destination} onChange={(e) => setDestination(e.target.value)} />
                        <div className="flex justify-end gap-2 pt-1">
                          <Button variant="secondary" size="sm" onClick={() => setLoggingDelivery(false)}>
                            Cancel
                          </Button>
                          <Button variant="primary" size="sm" onClick={handleLogDelivery} disabled={savingDelivery}>
                            {savingDelivery ? "Saving…" : "Save"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => setLoggingDelivery(true)}>
                        Log external delivery
                      </Button>
                    )
                  ) : (
                    <p className="text-sm text-zinc-400">Not sent via an external courier.</p>
                  )}
                </section>
              </div>
            </div>

            {(nextAction || canCancel) && (
              <div className="flex gap-2 mt-4">
                {canCancel && (
                  <Button variant="danger" onClick={handleCancel}>
                    Cancel order
                  </Button>
                )}
                {nextAction && (
                  <Button variant="primary" onClick={handleAdvance}>
                    {nextAction.label}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {editingItems && order && (
        <EditOrderItemsModal
          order={order}
          onClose={() => setEditingItems(false)}
          onSaved={(updated) => {
            setOrder(updated);
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
