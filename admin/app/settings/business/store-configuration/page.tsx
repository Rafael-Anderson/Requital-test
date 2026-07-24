"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { getShop, updateShop } from "@/lib/api";
import type { BusinessHours, ProductDisplayOrientation, Shop, ShopLanguage } from "@/lib/types";
import { defaultBusinessHours, mergeBusinessHours } from "@/lib/business-hours";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Checkbox from "@/components/ui/Checkbox";
import BusinessHoursEditor from "@/components/BusinessHoursEditor";
import { useToast } from "@/components/ui/Toast";

const BUSINESS_TYPES = ["Florist", "Gift Shop", "Bakery", "Restaurant", "Grocery", "Retail", "Other"];

// Gulf-region currencies plus USD — same UAE-market scope as the dial codes
// on the Business Information tab.
const CURRENCIES = ["AED", "SAR", "KWD", "QAR", "BHD", "OMR", "USD"];

function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-black/15 dark:border-white/15 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors cursor-pointer ${
            value === opt.value
              ? "bg-black text-white dark:bg-white dark:text-black"
              : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export default function StoreConfigurationPage() {
  const [shop, setShop] = useState<Shop | null>(null);
  const [businessType, setBusinessType] = useState(BUSINESS_TYPES[0]);
  const [currency, setCurrency] = useState("AED");
  const [defaultLanguage, setDefaultLanguage] = useState<ShopLanguage>("en");
  const [defaultDeliveryFee, setDefaultDeliveryFee] = useState("0");
  const [taxDisplayText, setTaxDisplayText] = useState("");
  const [productDisplayOrientation, setProductDisplayOrientation] =
    useState<ProductDisplayOrientation>("grid");
  const [productImageZoomEnabled, setProductImageZoomEnabled] = useState(true);
  const [showCategoryMenu, setShowCategoryMenu] = useState(true);
  const [allowPreOrders, setAllowPreOrders] = useState(false);
  const [customerConfirmationRequired, setCustomerConfirmationRequired] = useState(false);
  const [externalDeliveryEnabled, setExternalDeliveryEnabled] = useState(false);
  const [asapDeliveryEnabled, setAsapDeliveryEnabled] = useState(false);
  const [deliveryCalendarEnabled, setDeliveryCalendarEnabled] = useState(false);
  const [businessHours, setBusinessHours] = useState<BusinessHours>(defaultBusinessHours());
  const [whatsappFloatingButtonEnabled, setWhatsappFloatingButtonEnabled] = useState(false);
  const [birthdayDiscountEnabled, setBirthdayDiscountEnabled] = useState(false);
  const [productVariantsEnabled, setProductVariantsEnabled] = useState(false);
  const [productAttributesEnabled, setProductAttributesEnabled] = useState(false);
  const [productFaqsEnabled, setProductFaqsEnabled] = useState(false);
  const [customerSurveyEnabled, setCustomerSurveyEnabled] = useState(false);
  const [dynamicThemeBuilderEnabled, setDynamicThemeBuilderEnabled] = useState(false);
  const [disableStoreCart, setDisableStoreCart] = useState(false);
  const [disableGoogleMaps, setDisableGoogleMaps] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    getShop().then((s) => {
      setShop(s);
      setBusinessType(s.businessType || BUSINESS_TYPES[0]);
      setCurrency(s.currency);
      setDefaultLanguage(s.defaultLanguage);
      setDefaultDeliveryFee(s.defaultDeliveryFee);
      setTaxDisplayText(s.taxDisplayText ?? "");
      setProductDisplayOrientation(s.productDisplayOrientation);
      setProductImageZoomEnabled(s.productImageZoomEnabled);
      setShowCategoryMenu(s.showCategoryMenu);
      setAllowPreOrders(s.allowPreOrders);
      setCustomerConfirmationRequired(s.customerConfirmationRequired);
      setExternalDeliveryEnabled(s.externalDeliveryEnabled);
      setAsapDeliveryEnabled(s.asapDeliveryEnabled);
      setDeliveryCalendarEnabled(s.deliveryCalendarEnabled);
      setBusinessHours(mergeBusinessHours(s.businessHours));
      setWhatsappFloatingButtonEnabled(s.whatsappFloatingButtonEnabled);
      setBirthdayDiscountEnabled(s.birthdayDiscountEnabled);
      setProductVariantsEnabled(s.productVariantsEnabled);
      setProductAttributesEnabled(s.productAttributesEnabled);
      setProductFaqsEnabled(s.productFaqsEnabled);
      setCustomerSurveyEnabled(s.customerSurveyEnabled);
      setDynamicThemeBuilderEnabled(s.dynamicThemeBuilderEnabled);
      setDisableStoreCart(s.disableStoreCart);
      setDisableGoogleMaps(s.disableGoogleMaps);
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await updateShop({
        businessType,
        currency,
        defaultLanguage,
        defaultDeliveryFee: Number(defaultDeliveryFee) || 0,
        taxDisplayText,
        productDisplayOrientation,
        productImageZoomEnabled,
        showCategoryMenu,
        allowPreOrders,
        customerConfirmationRequired,
        externalDeliveryEnabled,
        asapDeliveryEnabled,
        deliveryCalendarEnabled,
        businessHours: JSON.stringify(businessHours),
        whatsappFloatingButtonEnabled,
        birthdayDiscountEnabled,
        productVariantsEnabled,
        productAttributesEnabled,
        productFaqsEnabled,
        customerSurveyEnabled,
        dynamicThemeBuilderEnabled,
        disableStoreCart,
        disableGoogleMaps,
      });
      toast("Store configuration saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save store configuration", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!shop) return <p className="text-sm text-zinc-500">Loading…</p>;

  return (
    <div className="space-y-8">
      <Section title="General">
        <Field label="Business Type">
          <select
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value)}
            className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-black/40 dark:focus:border-white/40 focus:ring-[3px] focus:ring-black/10 dark:focus:ring-white/15"
          >
            {BUSINESS_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Currency">
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-black/40 dark:focus:border-white/40 focus:ring-[3px] focus:ring-black/10 dark:focus:ring-white/15"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Default Language">
          <SegmentedToggle
            value={defaultLanguage}
            onChange={setDefaultLanguage}
            options={[
              { value: "en", label: "English" },
              { value: "ar", label: "Arabic" },
            ]}
          />
        </Field>

        <Input
          label="Default Delivery Fee"
          type="number"
          min="0"
          step="0.01"
          value={defaultDeliveryFee}
          onChange={(e) => setDefaultDeliveryFee(e.target.value)}
        />
        <p className="text-xs text-zinc-400 -mt-3">
          Added to every order&apos;s total automatically — orders don&apos;t set their own fee yet.
        </p>

        <Input
          label="Tax Display Text"
          placeholder="e.g. Including VAT"
          value={taxDisplayText}
          onChange={(e) => setTaxDisplayText(e.target.value)}
        />
      </Section>

      <Section title="Storefront Display">
        <Field label="Product Display Orientation">
          <SegmentedToggle
            value={productDisplayOrientation}
            onChange={setProductDisplayOrientation}
            options={[
              { value: "grid", label: "Grid" },
              { value: "list", label: "List" },
            ]}
          />
        </Field>
        <p className="text-xs text-zinc-400 -mt-3">
          Saved as a preference only — no storefront exists yet to apply it to.
        </p>

        <div className="space-y-2">
          <Checkbox
            label="Product image zoom on detail view"
            checked={productImageZoomEnabled}
            onChange={(e) => setProductImageZoomEnabled(e.target.checked)}
          />
          <Checkbox
            label="Show category menu"
            checked={showCategoryMenu}
            onChange={(e) => setShowCategoryMenu(e.target.checked)}
          />
          <Checkbox
            label="Allow pre-orders"
            checked={allowPreOrders}
            onChange={(e) => setAllowPreOrders(e.target.checked)}
          />
          <Checkbox
            label="Customer confirmation required for order"
            checked={customerConfirmationRequired}
            onChange={(e) => setCustomerConfirmationRequired(e.target.checked)}
          />
        </div>
      </Section>

      <Section title="Delivery & Fulfillment">
        <div className="space-y-2">
          <Checkbox
            label="External delivery enabled"
            checked={externalDeliveryEnabled}
            onChange={(e) => setExternalDeliveryEnabled(e.target.checked)}
          />
          <Checkbox
            label='"As soon as possible" delivery option enabled'
            checked={asapDeliveryEnabled}
            onChange={(e) => setAsapDeliveryEnabled(e.target.checked)}
          />
          <Checkbox
            label="Enable delivery calendar / timeslots"
            checked={deliveryCalendarEnabled}
            onChange={(e) => setDeliveryCalendarEnabled(e.target.checked)}
          />
        </div>

        <div>
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Business Hours</p>
          <BusinessHoursEditor value={businessHours} onChange={setBusinessHours} />
        </div>
      </Section>

      <Section title="Engagement">
        <div className="space-y-2">
          <Checkbox
            label="WhatsApp floating button enabled"
            checked={whatsappFloatingButtonEnabled}
            onChange={(e) => setWhatsappFloatingButtonEnabled(e.target.checked)}
          />
          <Checkbox
            label="Birthday discount enabled"
            checked={birthdayDiscountEnabled}
            onChange={(e) => setBirthdayDiscountEnabled(e.target.checked)}
          />
        </div>
        <p className="text-xs text-zinc-400">
          UI toggles only — no WhatsApp integration or discount engine is connected yet.
        </p>
      </Section>

      <Section title="Coming Soon">
        <p className="text-xs text-zinc-400 -mt-1">
          These save a preference now, but the feature behind them doesn&apos;t exist yet — toggling
          has no effect until it&apos;s built.
        </p>
        <div className="space-y-2">
          <Checkbox
            label="Product variants enabled"
            checked={productVariantsEnabled}
            onChange={(e) => setProductVariantsEnabled(e.target.checked)}
          />
          <Checkbox
            label="Product attributes enabled"
            checked={productAttributesEnabled}
            onChange={(e) => setProductAttributesEnabled(e.target.checked)}
          />
          <Checkbox
            label="Product FAQs enabled"
            checked={productFaqsEnabled}
            onChange={(e) => setProductFaqsEnabled(e.target.checked)}
          />
          <Checkbox
            label="Customer survey for order enabled"
            checked={customerSurveyEnabled}
            onChange={(e) => setCustomerSurveyEnabled(e.target.checked)}
          />
          <Checkbox
            label="Dynamic theme builder enabled"
            checked={dynamicThemeBuilderEnabled}
            onChange={(e) => setDynamicThemeBuilderEnabled(e.target.checked)}
          />
          <Checkbox
            label="Disable store cart"
            checked={disableStoreCart}
            onChange={(e) => setDisableStoreCart(e.target.checked)}
          />
          <Checkbox
            label="Disable Google Maps"
            checked={disableGoogleMaps}
            onChange={(e) => setDisableGoogleMaps(e.target.checked)}
          />
        </div>
      </Section>

      <Button variant="primary" onClick={handleSave} disabled={saving}>
        <Check className="size-4 inline -mt-0.5 mr-1" />
        Save changes
      </Button>
    </div>
  );
}
