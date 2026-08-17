"use client";

import { Calendar } from "lucide-react";
import type { ReactNode } from "react";
import { ORDER_STATUSES, type Outlet, type ReportsFilters } from "@/lib/types";
import Button from "@/components/ui/Button";
import Combobox from "@/components/ui/Combobox";

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
  "h-9 rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-3 text-[13.5px] font-semibold outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20";
const selectClass = reportsFilterInputClass;

function DefaultDateRangeControl({ value, onChange }: { value: ReportsFilters; onChange: (filters: ReportsFilters) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <Calendar className="size-4 text-text-faint shrink-0" />
      <input
        type="date"
        value={value.dateFrom ?? ""}
        max={value.dateTo}
        onChange={(e) => onChange({ ...value, dateFrom: e.target.value || undefined })}
        className={selectClass}
      />
      <span className="text-text-faint text-[12.5px]">to</span>
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

      <div className="w-40">
        <Combobox
          value={value.outletId !== undefined ? String(value.outletId) : ""}
          onChange={(v) => onChange({ ...value, outletId: v ? Number(v) : undefined })}
          placeholder="Select outlet"
          options={outlets.map((o) => ({ value: String(o.id), label: o.name }))}
        />
      </div>

      <div className="w-40">
        <Combobox
          value={value.orderType ?? ""}
          onChange={(v) => onChange({ ...value, orderType: v || undefined })}
          placeholder="Select order type"
          options={[
            { value: "delivery", label: "Delivery" },
            { value: "pickup", label: "Pickup" },
          ]}
        />
      </div>

      <div className="w-44">
        <Combobox
          value={value.status ?? ""}
          onChange={(v) => onChange({ ...value, status: (v || undefined) as ReportsFilters["status"] })}
          placeholder="Select order status"
          options={ORDER_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
        />
      </div>

      <div className="w-48">
        <Combobox
          value={value.paymentMode ?? ""}
          onChange={(v) => onChange({ ...value, paymentMode: v || undefined })}
          placeholder="Select payment mode"
          options={PAYMENT_MODES}
        />
      </div>

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
