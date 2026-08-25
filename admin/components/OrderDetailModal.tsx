"use client";

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import {
  cancelOrder,
  collectCash,
  createExternalDelivery,
  getOrder,
  getShop,
  updateExternalDelivery,
  updateOrderDeliveryFee,
  updateOrderStatus,
} from "@/lib/api";
import { getNextAction, type ExternalDelivery, type Order } from "@/lib/types";
import { waLink } from "@/lib/validators";
import { relativeTime } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import StatusBadge from "@/components/StatusBadge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Combobox from "@/components/ui/Combobox";
import Skeleton from "@/components/ui/Skeleton";
import Thumbnail from "@/components/ui/Thumbnail";
import { useToast } from "@/components/ui/Toast";
import OrderNotesSection from "@/components/OrderNotesSection";
import OrderReturnsSection from "@/components/OrderReturnsSection";
import OrderStatusTimeline from "@/components/OrderStatusTimeline";
import OrderInvoiceTab from "@/components/OrderInvoiceTab";
import SliderDeliveryPanel from "@/components/SliderDeliveryPanel";
import EditOrderItemsModal from "@/components/EditOrderItemsModal";
import Modal from "@/components/ui/Modal";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Tooltip from "@/components/ui/Tooltip";

const EXTERNAL_DELIVERY_STATUSES: ExternalDelivery["status"][] = ["pending", "picked_up", "delivered", "failed"];
// Mirrors the backend's own @Roles on the Slider dispatch/cancel routes —
// same allow-list as every other order-mutation action, unlike manual
// courier logging below (deliberately admin-only, see its own controller
// comment).
const SLIDER_ROLES = ["admin", "branch", "order_manager"];
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
  const [collectingCash, setCollectingCash] = useState(false);
  const [editingItems, setEditingItems] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [tab, setTab] = useState<"details" | "invoice">("details");
  const toast = useToast();

  useEffect(() => {
    if (orderId === null) return;
    setOrder(null);
    setError(null);
    setTab("details");
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

  if (orderId === null) return null;

  async function refetch() {
    try {
      setOrder(await getOrder(orderId!));
      setHistoryRefreshKey((k) => k + 1);
      onChanged?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to refresh order", "error");
    }
  }

  async function handleAdvance() {
    if (!order) return;
    const action = getNextAction(order.status);
    if (!action) return;
    if (action.next === "delivered" && order.paymentMethod === "cash_on_delivery" && !order.cashCollectedAt) return;
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

  async function handleCollectCash() {
    if (!order) return;
    setCollectingCash(true);
    try {
      await collectCash(order.id);
      toast("Cash collected");
      refetch();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to mark cash collected", "error");
    } finally {
      setCollectingCash(false);
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
  const isCod = order?.paymentMethod === "cash_on_delivery";
  const cashUncollected = isCod && !order?.cashCollectedAt;
  // Mirrors the backend's own pre-check in OrdersService.updateStatus —
  // this is UX-only, the server enforces the same gate independently.
  const advanceBlockedByCash = nextAction?.next === "delivered" && cashUncollected;

  return (
    <>
    <Modal
      onClose={onClose}
      size="lg"
      title={
        order ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span>Order #{order.id}</span>
            <StatusBadge status={order.status} />
          </div>
        ) : (
          "Order details"
        )
      }
      footer={
        order && (nextAction || canCancel)
          ? () => (
              <div className="flex items-center gap-3 flex-wrap justify-end">
                {advanceBlockedByCash && (
                  <p className="text-xs text-text-faint">Mark cash collected before completing this order.</p>
                )}
                {canCancel && (
                  <Button variant="danger" onClick={handleCancel}>
                    Cancel order
                  </Button>
                )}
                {nextAction && (
                  <Button variant="primary" onClick={handleAdvance} disabled={advanceBlockedByCash}>
                    {nextAction.label}
                  </Button>
                )}
              </div>
            )
          : undefined
      }
    >
        {error && <p className="text-red-600 text-sm">{error}</p>}

        {!order ? (
          <div className="space-y-4 pb-6">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4 flex-wrap text-sm text-text-muted mb-6">
              <span>Placed {relativeTime(order.createdAt)}</span>
              {order.deliveryDate && (
                <span>
                  Delivery {new Date(order.deliveryDate).toLocaleDateString()}
                  {order.deliveryTimeSlot ? ` · ${order.deliveryTimeSlot}` : ""}
                </span>
              )}
            </div>

            <div className="mb-4">
              <SegmentedToggle
                value={tab}
                onChange={setTab}
                options={[
                  { value: "details", label: "Details" },
                  { value: "invoice", label: "Invoice" },
                ]}
              />
            </div>

            {tab === "invoice" ? (
              <OrderInvoiceTab orderId={order.id} />
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-4">
                <section className="border border-gray-200 rounded-lg p-4 dark:border-white/10">
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
                            {item.variantLabel ? ` · ${item.variantLabel}` : ""}
                          </div>
                          <div className="text-xs text-text-muted">
                            {item.quantity} × {item.priceAtPurchase} AED
                          </div>
                          {item.note && (
                            <div className="text-xs italic text-text-muted mt-0.5">Customer: {item.note}</div>
                          )}
                        </div>
                        <div className="text-sm font-medium">
                          {(Number(item.priceAtPurchase) * item.quantity).toFixed(2)} AED
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="border border-gray-200 rounded-lg p-4 dark:border-white/10">
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
                          <span className="text-text-muted">Subtotal</span>
                          <span>{subtotal.toFixed(2)} AED</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-text-muted">Delivery fee</span>
                          {editingFee ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                autoFocus
                                value={feeInput}
                                onChange={(e) => setFeeInput(e.target.value)}
                                className="h-7 w-24 rounded-md border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-2 text-sm text-right outline-none focus:border-accent"
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
                                className="text-xs text-text-faint underline decoration-transparent hover:decoration-current"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <span className="flex items-center gap-1.5">
                              {deliveryFee.toFixed(2)} AED
                              {canEditFee && (
                                <Tooltip label="Override the delivery fee for this order">
                                  <button
                                    onClick={() => {
                                      setFeeInput(deliveryFee.toFixed(2));
                                      setEditingFee(true);
                                    }}
                                    className="text-text-faint hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                                    aria-label="Edit delivery fee"
                                  >
                                    <Pencil className="size-3" />
                                  </button>
                                </Tooltip>
                              )}
                            </span>
                          )}
                        </div>
                        <div className="flex justify-between text-sm font-medium border-t border-gray-200 dark:border-white/10 mt-2 pt-2">
                          <span>Total</span>
                          <span>{order.total} AED</span>
                        </div>
                        {taxDisplayText && (
                          <p className="text-xs text-text-faint mt-1 text-right">{taxDisplayText}</p>
                        )}
                      </>
                    );
                  })()}
                </section>

                {order.receiverMessage && (
                  <section className="border border-gray-200 rounded-lg p-4 dark:border-white/10">
                    <h3 className="font-medium mb-2">Receiver / greeting message</h3>
                    <p className="text-sm whitespace-pre-wrap">{order.receiverMessage}</p>
                  </section>
                )}

                {order.surveyresponse?.respondedAt && (
                  <section className="border border-gray-200 rounded-lg p-4 dark:border-white/10">
                    <h3 className="font-medium mb-2">Customer survey</h3>
                    <p className="text-sm">Rating: {order.surveyresponse.rating}/5</p>
                    {order.surveyresponse.comment && (
                      <p className="text-sm text-text-muted mt-1 whitespace-pre-wrap">{order.surveyresponse.comment}</p>
                    )}
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
                <section className="border border-gray-200 rounded-lg p-4 dark:border-white/10">
                  <h3 className="font-medium mb-3">Order info</h3>
                  <div className="space-y-2">
                    {order.orderType && (
                      <div className="flex justify-between text-sm">
                        <span className="text-text-muted">Type</span>
                        <span className="font-medium capitalize">{order.orderType}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-start text-sm">
                      <span className="text-text-muted">Payment</span>
                      <div className="text-right">
                        <StatusBadge status={order.paymentStatus} />
                        {order.paymentMethod && (
                          <div className="text-xs text-text-muted mt-1 capitalize">
                            {order.paymentMethod.replace(/_/g, " ")}
                          </div>
                        )}
                        {latestTxn && (
                          <div className="text-xs text-text-muted mt-1 capitalize">
                            via {latestTxn.gateway}
                          </div>
                        )}
                      </div>
                    </div>
                    {isCod && (
                      <div className="flex justify-between items-center text-sm pt-1 border-t border-gray-200 dark:border-white/10">
                        <span className="text-text-muted">Cash collected</span>
                        {order.cashCollectedAt ? (
                          <span className="text-right text-xs">
                            <span className="text-green-700 dark:text-green-400 font-medium">Collected ✓</span>
                            <br />
                            {new Date(order.cashCollectedAt).toLocaleString()}
                            {order.cashCollectedByName ? ` · ${order.cashCollectedByName}` : ""}
                          </span>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleCollectCash}
                            disabled={collectingCash}
                            loading={collectingCash}
                          >
                            Mark cash collected
                          </Button>
                        )}
                      </div>
                    )}
                    {order.channel && (
                      <div className="flex justify-between text-sm">
                        <span className="text-text-muted">Channel</span>
                        <span className="font-medium">{order.channel}</span>
                      </div>
                    )}
                  </div>
                </section>

                <section className="border border-gray-200 rounded-lg p-4 dark:border-white/10">
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
                  <p className="text-sm text-text-muted mt-1">
                    <a
                      href={waLink(order.customerPhone)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-accent-text dark:hover:text-accent hover:underline"
                    >
                      {order.customerPhone}
                    </a>
                  </p>
                  {order.customerEmail && (
                    <p className="text-sm text-text-muted">{order.customerEmail}</p>
                  )}
                </section>

                <section className="border border-gray-200 rounded-lg p-4 dark:border-white/10">
                  <h3 className="font-medium mb-2">Delivery address</h3>
                  <p className="text-sm">{order.customerAddress}</p>
                  <p className="text-sm text-text-muted">
                    {order.area ? `${order.area}, ` : ""}
                    {order.emirate}
                  </p>
                  {order.deliveryNotes && (
                    <p className="text-sm text-text-muted mt-2">
                      <span className="text-text-faint">Notes: </span>
                      {order.deliveryNotes}
                    </p>
                  )}
                </section>

                <section className="border border-gray-200 rounded-lg p-4 dark:border-white/10">
                  <h3 className="font-medium mb-2">External delivery</h3>
                  {order.externaldelivery?.provider === "slider" ? (
                    <SliderDeliveryPanel order={order} onChanged={refetch} />
                  ) : order.externaldelivery ? (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-text-muted">Carrier</span>
                        <span className="font-medium">{order.externaldelivery.carrier}</span>
                      </div>
                      {order.externaldelivery.vehicleType && (
                        <div className="flex justify-between text-sm">
                          <span className="text-text-muted">Vehicle</span>
                          <span>{order.externaldelivery.vehicleType}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm">
                        <span className="text-text-muted">Destination</span>
                        <span className="text-right">{order.externaldelivery.destination}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-text-muted">Paid to carrier</span>
                        <span>{order.externaldelivery.price} AED</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-text-muted">Status</span>
                        {user?.role === "admin" ? (
                          <div className="w-36">
                            <Combobox
                              value={order.externaldelivery.status}
                              onChange={(value) => handleUpdateDeliveryStatus(value as ExternalDelivery["status"])}
                              options={EXTERNAL_DELIVERY_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
                            />
                          </div>
                        ) : (
                          <StatusBadge status={order.externaldelivery.status} />
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {user && SLIDER_ROLES.includes(user.role) && (
                        <SliderDeliveryPanel order={order} onChanged={refetch} />
                      )}
                      {user?.role === "admin" &&
                        (loggingDelivery ? (
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
                            <Input
                              label="Destination"
                              value={destination}
                              onChange={(e) => setDestination(e.target.value)}
                            />
                            <div className="flex justify-end gap-2 pt-1">
                              <Button variant="secondary" size="sm" onClick={() => setLoggingDelivery(false)}>
                                Cancel
                              </Button>
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={handleLogDelivery}
                                disabled={savingDelivery}
                                loading={savingDelivery}
                              >
                                {savingDelivery ? "Saving…" : "Save"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => setLoggingDelivery(true)}>
                            Log external delivery manually
                          </Button>
                        ))}
                      {!user || !SLIDER_ROLES.includes(user.role) ? (
                        <p className="text-sm text-text-faint">Not sent via an external courier.</p>
                      ) : null}
                    </div>
                  )}
                </section>
              </div>
            </div>
            )}

            <OrderStatusTimeline orderId={order.id} refreshKey={historyRefreshKey} />
          </>
        )}
    </Modal>

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
    </>
  );
}
