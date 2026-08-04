"use client";

import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { BUSINESS_TYPES } from "@/lib/useAccountSetupForm";
import type { AccountSetupFormState } from "@/lib/useAccountSetupForm";

export default function AccountSetupStepBusiness({
  form,
  registerFieldRef,
}: {
  form: AccountSetupFormState;
  registerFieldRef: (field: string) => (el: HTMLElement | null) => void;
}) {
  return (
    <div className="space-y-4">
      <Input
        ref={registerFieldRef("businessName")}
        label="Business Name"
        required
        value={form.businessName}
        onChange={(e) => form.businessNameHandlers.onChange(e.target.value)}
        onBlur={(e) => form.businessNameHandlers.onBlur(e.target.value)}
        error={form.touched.businessName ? form.fieldErrors.businessName : undefined}
      />
      <Select
        ref={registerFieldRef("businessType")}
        label="Business Type"
        required
        value={form.businessType}
        onChange={(e) => form.setBusinessType(e.target.value)}
        error={form.touched.businessType ? form.fieldErrors.businessType : undefined}
      >
        <option value="" disabled>
          Select a business type
        </option>
        {BUSINESS_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </Select>
      <Input
        ref={registerFieldRef("trn")}
        label="Trading Registry Number (TRN)"
        placeholder="100-1234-567-890"
        value={form.trn}
        onChange={(e) => form.trnHandlers.onChange(e.target.value)}
        onBlur={(e) => form.trnHandlers.onBlur(e.target.value)}
        error={form.touched.trn ? form.fieldErrors.trn : undefined}
      />
      <Input
        ref={registerFieldRef("websiteUrl")}
        label="Website URL"
        placeholder="https://example.com"
        value={form.websiteUrl}
        onChange={(e) => form.websiteUrlHandlers.onChange(e.target.value)}
        onBlur={(e) => form.websiteUrlHandlers.onBlur(e.target.value)}
        error={form.touched.websiteUrl ? form.fieldErrors.websiteUrl : undefined}
      />
    </div>
  );
}
