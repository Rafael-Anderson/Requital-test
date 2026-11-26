import { ADMIN_ORDER_SOURCE_LABELS } from "@/lib/types";

// An order an admin created (a converted draft order): who built it and how it
// is being paid, e.g. "Created by Sara · Payment link". Renders nothing for any
// other order.
export function adminOrderSourceText(order: {
  adminSource?: string | null;
  createdByName?: string | null;
}): string | null {
  if (!order.adminSource) return null;
  const how = ADMIN_ORDER_SOURCE_LABELS[order.adminSource] ?? order.adminSource;
  return order.createdByName ? `Created by ${order.createdByName} · ${how}` : `Created by staff · ${how}`;
}

// A card-link custom order still waiting for the customer's payment.
export function isAwaitingPayment(order: {
  adminSource?: string | null;
  paymentStatus?: string | null;
  status?: string | null;
}): boolean {
  return order.adminSource === "payment_link" && order.paymentStatus === "unpaid" && order.status === "pending";
}

export default function AdminOrderSource({
  order,
  className = "",
}: {
  order: { adminSource?: string | null; createdByName?: string | null; paymentStatus?: string | null; status?: string | null };
  className?: string;
}) {
  const text = adminOrderSourceText(order);
  if (!text) return null;
  return (
    <p className={`text-xs text-text-muted ${className}`} data-testid="admin-order-source">
      {text}
      {isAwaitingPayment(order) && (
        <span className="ms-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Awaiting payment
        </span>
      )}
    </p>
  );
}
