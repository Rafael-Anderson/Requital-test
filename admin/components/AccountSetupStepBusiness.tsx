"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import FieldErrorMessage from "@/components/ui/FieldErrorMessage";
import { BUSINESS_TYPES } from "@/lib/useAccountSetupForm";
import type { AccountSetupFormState, DomainType } from "@/lib/useAccountSetupForm";

const SUBDOMAIN_SUFFIX = ".requital.io";
const VPS_IP = "187.52.114.246";

export default function AccountSetupStepBusiness({
  form,
  registerFieldRef,
}: {
  form: AccountSetupFormState;
  registerFieldRef: (field: string) => (el: HTMLElement | null) => void;
}) {
  const [howToOpen, setHowToOpen] = useState(false);
  const subdomainError = form.touched.subdomain ? form.fieldErrors.subdomain : undefined;
  const customDomainError = form.touched.customDomain ? form.fieldErrors.customDomain : undefined;

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

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label className="text-sm font-medium text-text-secondary dark:text-zinc-400">Storefront domain</label>
          <SegmentedToggle<DomainType>
            value={form.domainType}
            onChange={form.setDomainType}
            options={[
              { value: "subdomain", label: "Subdomain" },
              { value: "custom", label: "Custom domain" },
            ]}
          />
        </div>

        {form.domainType === "subdomain" ? (
          <div>
            <div
              className={`flex h-9 w-full overflow-hidden rounded-lg border shadow-sm shadow-black/5 transition-shadow focus-within:ring-[3px] ${
                subdomainError
                  ? "border-red-400 dark:border-red-700 focus-within:border-red-400 focus-within:ring-red-500/20"
                  : "border-border dark:border-white/15 focus-within:border-accent focus-within:ring-accent/20"
              }`}
            >
              <input
                ref={registerFieldRef("subdomain")}
                type="text"
                aria-label="Subdomain"
                value={form.subdomain}
                onChange={(e) => form.subdomainHandlers.onChange(e.target.value)}
                onBlur={(e) => form.subdomainHandlers.onBlur(e.target.value)}
                aria-invalid={!!subdomainError}
                className={`h-full min-w-0 flex-1 border-0 bg-surface dark:bg-zinc-900 px-3 text-sm outline-none placeholder:text-text-faint ${
                  subdomainError ? "text-red-700 dark:text-red-400" : ""
                }`}
              />
              <span className="flex shrink-0 items-center rounded-r-lg border-l border-border dark:border-white/15 bg-zinc-100 dark:bg-zinc-800 px-3 text-sm text-text-muted dark:text-zinc-400">
                {SUBDOMAIN_SUFFIX}
              </span>
            </div>
            {subdomainError && <FieldErrorMessage message={subdomainError} />}
          </div>
        ) : (
          <div>
            <input
              ref={registerFieldRef("customDomain")}
              type="text"
              aria-label="Custom domain"
              placeholder="example.com"
              value={form.customDomain}
              onChange={(e) => form.customDomainHandlers.onChange(e.target.value)}
              onBlur={(e) => form.customDomainHandlers.onBlur(e.target.value)}
              aria-invalid={!!customDomainError}
              className={`flex h-9 w-full rounded-lg border bg-surface dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 transition-shadow outline-none placeholder:text-text-faint ${
                customDomainError
                  ? "border-red-400 dark:border-red-700 text-red-700 dark:text-red-400 focus:border-red-400 focus:ring-[3px] focus:ring-red-500/20"
                  : "border-border dark:border-white/15 focus:border-accent focus:ring-[3px] focus:ring-accent/20"
              }`}
            />
            {customDomainError && <FieldErrorMessage message={customDomainError} />}

            <div className="mt-3 rounded-lg border border-border dark:border-white/10 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2">
              <button
                type="button"
                onClick={() => setHowToOpen((v) => !v)}
                className="flex w-full items-center justify-between text-left text-xs font-medium text-text-secondary dark:text-zinc-400 cursor-pointer"
              >
                How to connect your domain
                <ChevronDown className={`size-3.5 transition-transform ${howToOpen ? "rotate-180" : ""}`} />
              </button>
              {howToOpen && (
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-text-muted dark:text-zinc-400">
                  <li>Log in to your domain registrar</li>
                  <li>
                    Add an A record pointing to <span className="font-mono">{VPS_IP}</span>
                  </li>
                  <li>It may take up to 24 hours to propagate</li>
                </ol>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
