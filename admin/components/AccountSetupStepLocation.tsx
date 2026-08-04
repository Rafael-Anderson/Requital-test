"use client";

import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Checkbox from "@/components/ui/Checkbox";
import FieldErrorMessage from "@/components/ui/FieldErrorMessage";
import { BRANCH_COUNTS, OPERATING_MODELS } from "@/lib/useAccountSetupForm";
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
            <Checkbox
              key={option.value}
              label={option.label}
              checked={form.operatingModel.has(option.value)}
              onChange={() => form.toggleOperatingModel(option.value)}
            />
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
