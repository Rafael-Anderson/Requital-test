"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { getShop, updateShop } from "@/lib/api";
import type { BusinessHours, ProductDisplayOrientation, Shop, ShopLanguage } from "@/lib/types";
import { defaultBusinessHours, mergeBusinessHours } from "@/lib/business-hours";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Checkbox from "@/components/ui/Checkbox";
import Card from "@/components/ui/Card";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Toggle from "@/components/ui/Toggle";
import BusinessHoursEditor from "@/components/BusinessHoursEditor";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";

const BUSINESS_TYPES = ["Florist", "Gift Shop", "Bakery", "Restaurant", "Grocery", "Retail", "Other"];

// Gulf-region currencies plus USD — same UAE-market scope as the dial codes
// on the Business Information tab.
const CURRENCIES = ["AED", "SAR", "KWD", "QAR", "BHD", "OMR", "USD"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-text-secondary dark:text-zinc-400 block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-3">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
    </Card>
  );
}

export default function StoreConfigurationPage() {
  const [shop, setShop] = useState<Shop | null>(null);
  const [businessType, setBusinessType] = useState(BUSINESS_TYPES[0]);
  const [currency, setCurrency] = useState("AED");
  const [defaultLanguage, setDefaultLanguage] = useState<ShopLanguage>("en");
  const [defaultDeliveryFee, setDefaultDeliveryFee] = useState("0");
  const [taxDisplayText, setTaxDisplayText] = useState("");
  const [productDisplayOrientation, setProductDisplayOrientation] = useState<ProductDisplayOrientation>("grid");
  const [productImageZoomEnabled, setProductImageZoomEnabled] = useState(true);
  const [showCollectionMenu, setShowCollectionMenu] = useState(true);
  const [allowPreOrders, setAllowPreOrders] = useState(false);
  const [customerConfirmationRequired, setCustomerConfirmationRequired] = useState(false);
  const [externalDeliveryEnabled, setExternalDeliveryEnabled] = useState(false);
  const [asapDeliveryEnabled, setAsapDeliveryEnabled] = useState(false);
  const [deliveryCalendarEnabled, setDeliveryCalendarEnabled] = useState(false);
  const [businessHours, setBusinessHours] = useState<BusinessHours>(defaultBusinessHours());
  const [birthdayDiscountEnabled, setBirthdayDiscountEnabled] = useState(false);
  const [customerSurveyEnabled, setCustomerSurveyEnabled] = useState(false);
  const [dynamicThemeBuilderEnabled, setDynamicThemeBuilderEnabled] = useState(false);
  const [disableStoreCart, setDisableStoreCart] = useState(false);
  const [cartDisabledMode, setCartDisabledMode] = useState<"buy_now" | "contact_to_order">("buy_now");
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
      setShowCollectionMenu(s.showCollectionMenu);
      setAllowPreOrders(s.allowPreOrders);
      setCustomerConfirmationRequired(s.customerConfirmationRequired);
      setExternalDeliveryEnabled(s.externalDeliveryEnabled);
      setAsapDeliveryEnabled(s.asapDeliveryEnabled);
      setDeliveryCalendarEnabled(s.deliveryCalendarEnabled);
      setBusinessHours(mergeBusinessHours(s.businessHours));
      setBirthdayDiscountEnabled(s.birthdayDiscountEnabled);
      setCustomerSurveyEnabled(s.customerSurveyEnabled);
      setDynamicThemeBuilderEnabled(s.dynamicThemeBuilderEnabled);
      setDisableStoreCart(s.disableStoreCart);
      setCartDisabledMode(s.cartDisabledMode);
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
        showCollectionMenu,
        allowPreOrders,
        customerConfirmationRequired,
        externalDeliveryEnabled,
        asapDeliveryEnabled,
        deliveryCalendarEnabled,
        businessHours: JSON.stringify(businessHours),
        birthdayDiscountEnabled,
        customerSurveyEnabled,
        dynamicThemeBuilderEnabled,
        disableStoreCart,
        cartDisabledMode,
      });
      toast("Store configuration saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save store configuration", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!shop) return <p className="text-sm text-text-muted">Loading…</p>;

  return (
    <PageShell>
      <div className="space-y-4">
        <Section title="General">
          <Field label="Business Type">
            <select
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className="flex h-9 w-full rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
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
              className="flex h-9 w-full rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
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

          <div>
            <Input
              label="Default Delivery Fee"
              type="number"
              min="0"
              step="0.01"
              value={defaultDeliveryFee}
              onChange={(e) => setDefaultDeliveryFee(e.target.value)}
            />
            <p className="text-xs text-text-faint mt-1.5">
              Added to every order&apos;s total automatically. Orders don&apos;t set their own fee yet.
            </p>
          </div>

          <Input
            label="Tax Display Text"
            placeholder="e.g. Including VAT"
            value={taxDisplayText}
            onChange={(e) => setTaxDisplayText(e.target.value)}
          />
        </Section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <div className="space-y-4">
            <Card>
              <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-3">Storefront Display</h3>
              <div className="space-y-4">
                <div>
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
                </div>

                <div className="space-y-2">
                  <Checkbox
                    label="Product image zoom on detail view"
                    checked={productImageZoomEnabled}
                    onChange={(e) => setProductImageZoomEnabled(e.target.checked)}
                  />
                  <Checkbox
                    label="Show collection menu"
                    checked={showCollectionMenu}
                    onChange={(e) => setShowCollectionMenu(e.target.checked)}
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
              </div>
            </Card>

            <Card>
              <p className="text-sm font-medium text-text-secondary dark:text-zinc-400 mb-2">Business Hours</p>
              <BusinessHoursEditor value={businessHours} onChange={setBusinessHours} />
            </Card>

            <Button variant="primary" onClick={handleSave} disabled={saving} className="w-fit" loading={saving}>
              <Check className="size-4 inline -mt-0.5 mr-1" />
              Save changes
            </Button>
          </div>

          <div className="space-y-4">
            <Card>
              <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-3">Delivery & Fulfillment</h3>
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
            </Card>

            <Card>
              <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-3">Engagement</h3>
              <div className="space-y-3">
                <p className="text-xs text-text-faint">
                  The WhatsApp floating button moved to{" "}
                  <Link href="/integrations/messaging" className="text-accent-text dark:text-accent hover:underline">
                    Integrations &gt; Messaging
                  </Link>
                  , alongside your WhatsApp number and notification settings.
                </p>
                <div>
                  <Checkbox
                    label="Birthday discount enabled"
                    checked={birthdayDiscountEnabled}
                    onChange={(e) => setBirthdayDiscountEnabled(e.target.checked)}
                  />
                  <p className="text-xs text-text-faint mt-1">
                    Saved as a preference only. Not yet active. No discount engine is connected to it yet.
                  </p>
                </div>
              </div>
            </Card>

            <Card>
              <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-3">Cart & Checkout</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Toggle checked={disableStoreCart} onChange={setDisableStoreCart} />
                  <span className="text-sm">Disable store cart</span>
                </div>
                {disableStoreCart && (
                  <div className="pl-1">
                    <Field label="When cart is disabled, customers should">
                      <SegmentedToggle
                        value={cartDisabledMode}
                        onChange={setCartDisabledMode}
                        options={[
                          { value: "buy_now", label: "Buy now (skip cart)" },
                          { value: "contact_to_order", label: "Contact to order" },
                        ]}
                      />
                    </Field>
                    {cartDisabledMode === "contact_to_order" && !shop.whatsappNumber && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                        Set a WhatsApp number in{" "}
                        <Link href="/integrations/messaging" className="underline">
                          Integrations &gt; Messaging
                        </Link>{" "}
                        for the &quot;Contact to order&quot; button to work.
                      </p>
                    )}
                  </div>
                )}
              </div>
              <p className="text-xs text-text-faint mt-3">
                &quot;Buy now&quot; skips the cart page. Add to Cart on a product takes the customer straight to
                checkout with just that item. &quot;Contact to order&quot; removes checkout entirely and shows a
                WhatsApp button instead.
              </p>
            </Card>

            <Card>
              <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-3">Post-Purchase</h3>
              <div className="flex items-center gap-2">
                <Toggle checked={customerSurveyEnabled} onChange={setCustomerSurveyEnabled} />
                <span className="text-sm">Customer survey for order enabled</span>
              </div>
              <p className="text-xs text-text-faint mt-3">
                Emails the customer a short rating + comment survey once their order is marked delivered.
              </p>
            </Card>

            <Card>
              <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-1">Coming Soon</h3>
              <p className="text-xs text-text-faint mb-3">
                Saves a preference now, but the feature behind it doesn&apos;t exist yet. Toggling has no effect
                until it&apos;s built.
              </p>
              <Checkbox
                label="Dynamic theme builder enabled"
                checked={dynamicThemeBuilderEnabled}
                onChange={(e) => setDynamicThemeBuilderEnabled(e.target.checked)}
              />
            </Card>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
