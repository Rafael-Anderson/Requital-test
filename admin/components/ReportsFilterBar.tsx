"use client";

import { Calendar } from "lucide-react";
import type { ReactNode } from "react";
import { ORDER_STATUSES, type Outlet, type ReportsFilters } from "@/lib/types";
import Button from "@/components/ui/Button";

const PAYMENT_MODES = [
  { value: "card_online", label: "Card (Online)" },
  { value: "cash_on_delivery", label: "Cash on Delivery" },
  { value: "card_on_delivery", label: "Card on Delivery" },
  { value: "cash_on_pickup", label: "Cash on Pickup" },
  { value: "card_on_pickup", label: "Card on Pickup" },
];

// Exported so callers building their own date/month control (Monthly
// Report's month picker) match this bar's other inputs exactly.
export const reportsFilterInputClass =
  "h-9 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20";
const selectClass = reportsFilterInputClass;

function DefaultDateRangeControl({ value, onChange }: { value: ReportsFilters; onChange: (filters: ReportsFilters) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <Calendar className="size-4 text-zinc-400 shrink-0" />
      <input
        type="date"
        value={value.dateFrom ?? ""}
        max={value.dateTo}
        onChange={(e) => onChange({ ...value, dateFrom: e.target.value || undefined })}
        className={selectClass}
      />
      <span className="text-zinc-400 text-sm">to</span>
      <input
        type="date"
        value={value.dateTo ?? ""}
        min={value.dateFrom}
        onChange={(e) => onChange({ ...value, dateTo: e.target.value || undefined })}
        className={selectClass}
      />
    </div>
  );
}

// Deliberately empty by default (no implicit date range) — unlike
// DashboardPage's DateRangePicker, which always has a 30-day default,
// Reports' filters start with nothing applied so the stat cards show the
// shop's true all-time totals until a merchant narrows them. Channel is a
// free-text input, not a dropdown of known values — order.channel has no
// real multi-channel attribution system behind it (see backend
// ReportsFilterQueryDto), so there's no fixed list to offer.
//
// `dateControl` lets Monthly Report swap in a month picker instead of the
// date-range inputs while keeping every other filter (outlet/type/status/
// payment/channel/Apply button) byte-for-byte identical — General Report
// and External Delivery Report both use the default.
export default function ReportsFilterBar({
  value,
  onChange,
  outlets,
  onApply,
  dateControl,
}: {
  value: ReportsFilters;
  onChange: (filters: ReportsFilters) => void;
  outlets: Outlet[];
  onApply: () => void;
  dateControl?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {dateControl ?? <DefaultDateRangeControl value={value} onChange={onChange} />}

      <select
        value={value.outletId ?? ""}
        onChange={(e) => onChange({ ...value, outletId: e.target.value ? Number(e.target.value) : undefined })}
        className={selectClass}
      >
        <option value="">Select outlet</option>
        {outlets.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>

      <select
        value={value.orderType ?? ""}
        onChange={(e) => onChange({ ...value, orderType: e.target.value || undefined })}
        className={selectClass}
      >
        <option value="">Select order type</option>
        <option value="delivery">Delivery</option>
        <option value="pickup">Pickup</option>
      </select>

      <select
        value={value.status ?? ""}
        onChange={(e) => onChange({ ...value, status: (e.target.value || undefined) as ReportsFilters["status"] })}
        className={selectClass}
      >
        <option value="">Select order status</option>
        {ORDER_STATUSES.map((s) => (
          <option key={s} value={s} className="capitalize">
            {s.replace(/_/g, " ")}
          </option>
        ))}
      </select>

      <select
        value={value.paymentMode ?? ""}
        onChange={(e) => onChange({ ...value, paymentMode: e.target.value || undefined })}
        className={selectClass}
      >
        <option value="">Select payment mode</option>
        {PAYMENT_MODES.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      <input
        value={value.channel ?? ""}
        onChange={(e) => onChange({ ...value, channel: e.target.value || undefined })}
        placeholder="Select channel"
        className={`${selectClass} w-36`}
      />

      <Button variant="primary" onClick={onApply}>
        Apply Filters
      </Button>
    </div>
  );
}
