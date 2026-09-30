"use client";

import { useShop } from "@/lib/shop-context";
import { FIELD_CLASS } from "./checkout-field-styles";

// The region (emirate, province, governorate...) picker. Its options and its
// label come from the shop's own country via useShop(); nothing here knows which
// country that is. Renders nothing for a shop whose country has no regions, so a
// form simply has no such field rather than a meaningless one.
//
// No option is pre-selected: a silent default ("Dubai") is how a customer ends up
// charged the wrong zone fee without noticing. `required` makes the browser stop
// a submit that left it blank.
export default function RegionSelect({
  value,
  onChange,
  required = true,
  className = FIELD_CLASS,
}: {
  value: number | null;
  onChange: (regionId: number | null) => void;
  required?: boolean;
  className?: string;
}) {
  const { regions, regionLabel } = useShop();
  if (regions.length === 0) return null;
  return (
    <div>
      <label className="text-sm font-medium block mb-1">{regionLabel}</label>
      <select
        required={required}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={className}
      >
        <option value="" disabled>
          Select {regionLabel.toLowerCase()}
        </option>
        {regions.map((r) => (
          <option key={r.id} value={r.id}>
            {r.nameEn}
          </option>
        ))}
      </select>
    </div>
  );
}
