"use client";

import { OPERATING_MODELS } from "@/lib/useAccountSetupForm";
import type { AccountSetupFormState } from "@/lib/useAccountSetupForm";

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm border-b border-black/5 dark:border-white/10 last:border-0">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="font-medium text-zinc-900 dark:text-zinc-100 text-right">{value || "-"}</span>
    </div>
  );
}

const PRODUCT_EDITOR_MODES = [
  {
    value: "simple" as const,
    label: "Simple",
    tagline: "Multi-step form",
    description: "Variants, attributes, and FAQ disabled by default. Turn them on per product if needed",
  },
  {
    value: "advanced" as const,
    label: "Advanced",
    tagline: "Single-page form",
    description: "All features enabled, scroll down to access everything at once",
  },
];

export default function AccountSetupStepReview({ form }: { form: AccountSetupFormState }) {
  const operatingModelLabel =
    OPERATING_MODELS.find((o) => o.value === form.operatingModel)?.label ?? "-";
  const domainValue =
    form.domainType === "custom" ? form.customDomain : `${form.subdomain}.requital.io`;

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Click a completed step above to go back and edit it.
      </p>

      <div>
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
          How do you want to manage products?
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PRODUCT_EDITOR_MODES.map((mode) => (
            <label
              key={mode.value}
              className={`rounded-lg border p-3 text-sm cursor-pointer transition-colors ${
                form.productEditorMode === mode.value
                  ? "border-black/40 dark:border-white/40 bg-black/[0.02] dark:bg-white/[0.03]"
                  : "border-black/15 dark:border-white/15 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
              }`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="radio"
                  name="productEditorMode"
                  className="accent-black dark:accent-white shrink-0 mt-0.5"
                  checked={form.productEditorMode === mode.value}
                  onChange={() => form.setProductEditorMode(mode.value)}
                />
                <div>
                  <p className="font-medium">{mode.label}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{mode.tagline}</p>
                  <p className="text-xs text-zinc-400 mt-1">{mode.description}</p>
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-black/10 dark:border-white/10 p-4">
        <ReviewRow label="First Name" value={form.firstName} />
        <ReviewRow label="Email" value={form.email} />
        <ReviewRow label="Phone Number" value={form.phone} />
        <ReviewRow label="Business Name" value={form.businessName} />
        <ReviewRow label="Storefront Domain" value={domainValue} />
        <ReviewRow label="Location" value={form.address} />
        <ReviewRow label="Operating Model" value={operatingModelLabel} />
        <ReviewRow label="Number of Branches" value={form.branchCount} />
      </div>
    </div>
  );
}
