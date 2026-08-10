"use client";

import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import FieldErrorMessage from "@/components/ui/FieldErrorMessage";
import { BRANCH_COUNTS, COUNTRIES, OPERATING_MODELS } from "@/lib/useAccountSetupForm";
import type { AccountSetupFormState } from "@/lib/useAccountSetupForm";

export default function AccountSetupStepLocation({
  form,
  registerFieldRef,
}: {
  form: AccountSetupFormState;
  registerFieldRef: (field: string) => (el: HTMLElement | null) => void;
}) {
  const operatingModelError = form.touched.operatingModel ? form.fieldErrors.operatingModel : undefined;

  return (
    <div className="space-y-4">
      <Select
        ref={registerFieldRef("country")}
        label="Country"
        required
        value={form.country}
        onChange={(e) => form.setCountry(e.target.value)}
        error={form.touched.country ? form.fieldErrors.country : undefined}
      >
        {COUNTRIES.map((country) => (
          <option key={country} value={country}>
            {country}
          </option>
        ))}
      </Select>

      <Input
        ref={registerFieldRef("address")}
        label="Primary Location / Address"
        required
        value={form.address}
        onChange={(e) => form.addressHandlers.onChange(e.target.value)}
        onBlur={(e) => form.addressHandlers.onBlur(e.target.value)}
        error={form.touched.address ? form.fieldErrors.address : undefined}
      />

      <div ref={registerFieldRef("operatingModel")} tabIndex={-1} className="outline-none">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
          Operating Model <span className="text-red-500">*</span>
        </span>
        <div className="space-y-2">
          {OPERATING_MODELS.map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2 text-sm cursor-pointer select-none"
            >
              <span className="relative inline-flex size-4 shrink-0">
                <input
                  type="radio"
                  name="operatingModel"
                  value={option.value}
                  checked={form.operatingModel === option.value}
                  onChange={() => form.setOperatingModel(option.value)}
                  className="peer absolute inset-0 size-4 cursor-pointer appearance-none"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-full border-[1.5px] border-black/25 dark:border-white/30 bg-white dark:bg-zinc-900 transition-colors duration-150 peer-hover:border-black/45 dark:peer-hover:border-white/45 peer-checked:border-black dark:peer-checked:border-white peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50 peer-focus-visible:ring-offset-1"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 m-auto size-2 rounded-full bg-black dark:bg-white scale-0 opacity-0 transition-all duration-150 peer-checked:scale-100 peer-checked:opacity-100"
                />
              </span>
              {option.label}
            </label>
          ))}
        </div>
        {operatingModelError && <FieldErrorMessage message={operatingModelError} />}
      </div>

      <Select
        ref={registerFieldRef("branchCount")}
        label="Number of Branches"
        required
        value={form.branchCount}
        onChange={(e) => form.setBranchCount(e.target.value)}
        error={form.touched.branchCount ? form.fieldErrors.branchCount : undefined}
      >
        <option value="" disabled>
          Select branch count
        </option>
        {BRANCH_COUNTS.map((count) => (
          <option key={count} value={count}>
            {count}
          </option>
        ))}
      </Select>
    </div>
  );
}
