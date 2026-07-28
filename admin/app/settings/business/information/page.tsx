"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import {
  clearWhatsAppCredentials,
  getPublishReadiness,
  getShop,
  getWhatsAppSettings,
  resolveImageUrl,
  setWhatsAppCredentials,
  storefrontUrlFor,
  updateShop,
  uploadShopLogo,
} from "@/lib/api";
import { WHATSAPP_CREDENTIAL_FIELDS, type PublishReadiness, type Shop, type TrademarkFormat, type WhatsAppSettings } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Checkbox from "@/components/ui/Checkbox";
import Card from "@/components/ui/Card";
import ImageDropzone from "@/components/ui/ImageDropzone";
import Toggle from "@/components/ui/Toggle";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";

// Self-contained, same reasoning as PublishCard below — this saves via its
// own dedicated endpoint (/whatsapp-settings), not the page's bundled
// Save changes button, and shouldn't share its credential-input state with
// the rest of the form's lifecycle.
function WhatsAppCredentialsCard() {
  const toast = useToast();
  const [settings, setSettings] = useState<WhatsAppSettings | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getWhatsAppSettings()
      .then(setSettings)
      .catch(() => setSettings({ hasCredentials: false, maskedCredentials: null }));
  }, []);

  async function handleSave() {
    const phoneNumberId = values.phoneNumberId?.trim();
    const accessToken = values.accessToken?.trim();
    if (!phoneNumberId || !accessToken) {
      toast("Both fields are required to save", "error");
      return;
    }
    setSaving(true);
    try {
      const updated = await setWhatsAppCredentials({ phoneNumberId, accessToken });
      setSettings(updated);
      setValues({});
      toast("WhatsApp Cloud API credentials saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save WhatsApp credentials", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!confirm("Remove the saved WhatsApp Cloud API credentials? Customer WhatsApp notifications will stop sending until reconfigured.")) {
      return;
    }
    setSaving(true);
    try {
      const updated = await clearWhatsAppCredentials();
      setSettings(updated);
      toast("WhatsApp credentials removed");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to remove WhatsApp credentials", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  return (
    <Card className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">WhatsApp Business API</h3>
        <p className="text-xs text-zinc-400 mt-1">
          Meta WhatsApp Cloud API credentials, used to send customer order notifications when
          &quot;Notify Customers via WhatsApp&quot; is on above. Business verification and number setup happen in
          Meta&apos;s own Business Manager — paste the resulting values here.
          {!settings.hasCredentials && " Without these, notifications fall back to a console log only (dev/testing)."}
        </p>
      </div>
      <div className="space-y-3">
        {WHATSAPP_CREDENTIAL_FIELDS.map((field) => (
          <div key={field.key}>
            <Input
              label={field.label}
              type="password"
              autoComplete="off"
              value={values[field.key] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            />
            {settings.maskedCredentials?.[field.key] && (
              <p className="mt-1 text-xs text-zinc-400">
                Currently saved: {settings.maskedCredentials[field.key]} — re-enter both fields to change either one.
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-zinc-400">Saves on its own — separate from the page's Save changes button below.</p>
        <div className="flex gap-2 shrink-0">
          {settings.hasCredentials && (
            <Button variant="secondary" onClick={handleClear} disabled={saving}>
              Remove
            </Button>
          )}
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save WhatsApp credentials"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// Saves immediately on toggle (same pattern as the Payment Gateways page's
// Cash on Delivery switch) — this is a "go live" action, not a field
// bundled into the page's larger Save changes button. Readiness (outlet
// with delivery/pickup enabled + at least one product) is checked via
// GET /shop/publish-readiness — the same logic backend ShopService enforces
// on the actual PATCH /shop transition, not a separately maintained copy —
// so the toggle is disabled with an inline note *before* the merchant tries,
// rather than letting them click it and only then see an error.
function PublishCard({ shop, onChange }: { shop: Shop; onChange: (published: boolean) => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [readiness, setReadiness] = useState<PublishReadiness | null>(null);

  useEffect(() => {
    // Already live — readiness no longer matters (see the backend's own
    // "don't retroactively unpublish" rule) and re-checking it would just
    // flash a confusing disabled toggle on a shop that's actually fine.
    if (shop.published) return;
    let cancelled = false;
    getPublishReadiness()
      .then((r) => {
        if (!cancelled) setReadiness(r);
      })
      .catch(() => {
        if (!cancelled) setReadiness(null);
      });
    return () => {
      cancelled = true;
    };
  }, [shop.published]);

  async function handleToggle(next: boolean) {
    setSaving(true);
    try {
      await updateShop({ published: next });
      onChange(next);
      toast(next ? "Your store is now published" : "Your store is now unpublished");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update publish status", "error");
    } finally {
      setSaving(false);
    }
  }

  const blocked = !shop.published && readiness !== null && !readiness.ready;
  const tooltip = blocked ? readiness!.missing.join(' — ') : undefined;

  return (
    <Card className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{shop.published ? "Store published" : "Publish your store"}</p>
        <p className="text-xs text-zinc-400 mt-1">
          {shop.published
            ? "Your storefront is live and listed in the sitemap."
            : "Your storefront isn't visible to customers yet."}
        </p>
        {shop.published ? (
          <p className="text-xs mt-1.5">
            Your store is live at{" "}
            <a
              href={storefrontUrlFor(shop)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent hover:underline"
            >
              {storefrontUrlFor(shop).replace(/^https?:\/\//, "")} ↗
            </a>
          </p>
        ) : (
          <p className="text-xs mt-1.5 text-zinc-400" title="Your store link will be live once published">
            Store link — available once published
          </p>
        )}
        {blocked && (
          <ul className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 space-y-0.5">
            {readiness!.missing.map((m) => (
              <li key={m}>• {m}</li>
            ))}
          </ul>
        )}
      </div>
      <span title={tooltip}>
        <Toggle checked={shop.published} onChange={handleToggle} disabled={saving || blocked} />
      </span>
    </Card>
  );
}

// UAE-focused dial codes — this is a UAE-market product, not a general
// international directory. Extend the list if that scope changes.
const WHATSAPP_COUNTRY_CODES = [
  "+971", "+966", "+965", "+974", "+973", "+968", "+91", "+92", "+1", "+44",
];

// No timezone library in the project — a fixed list covering the shop's
// operating region plus a few common ones, same tradeoff as the dial codes.
const TIMEZONES = [
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Kuwait",
  "Asia/Qatar",
  "Asia/Bahrain",
  "Asia/Muscat",
  "Asia/Kolkata",
  "Asia/Karachi",
  "Europe/London",
  "America/New_York",
  "UTC",
];

const CURRENT_YEAR = new Date().getFullYear();

export default function BusinessInformationPage() {
  const [shop, setShop] = useState<Shop | null>(null);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [trademarkFormat, setTrademarkFormat] = useState<TrademarkFormat>("brand");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [whatsappCountryCode, setWhatsappCountryCode] = useState("+971");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [description, setDescription] = useState("");
  const [country, setCountry] = useState("");
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("Asia/Dubai");
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(false);
  const [notifyCustomersWhatsapp, setNotifyCustomersWhatsapp] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [notifyAbandonedCart, setNotifyAbandonedCart] = useState(false);
  const [abandonedCartWindowMinutes, setAbandonedCartWindowMinutes] = useState(60);
  const [notifyLowStockDigest, setNotifyLowStockDigest] = useState(false);
  const [autoDeductIngredientStock, setAutoDeductIngredientStock] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    getShop().then((s) => {
      setShop(s);
      setName(s.name);
      setDisplayName(s.displayName ?? "");
      setLegalName(s.legalName ?? "");
      setTrademarkFormat(s.trademarkFormat);
      setLogoUrl(s.logoUrl);
      setLogoPreview(resolveImageUrl(s.logoUrl));
      setEmail(s.email ?? "");
      setWhatsappCountryCode(s.whatsappCountryCode ?? "+971");
      setWhatsappNumber(s.whatsappNumber ?? "");
      setDescription(s.description ?? "");
      setCountry(s.country ?? "");
      setAddress(s.address ?? "");
      setTimezone(s.timezone);
      setNotifyWhatsapp(s.notifyWhatsapp);
      setNotifyCustomersWhatsapp(s.notifyCustomersWhatsapp);
      setNotifyEmail(s.notifyEmail);
      setNotifyAbandonedCart(s.notifyAbandonedCart);
      setAbandonedCartWindowMinutes(s.abandonedCartWindowMinutes);
      setNotifyLowStockDigest(s.notifyLowStockDigest);
      setAutoDeductIngredientStock(s.autoDeductIngredientStock);
    });
  }, []);

  function handleLogoSelected(file: File) {
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  const brandPreviewName = displayName || name || "Your Brand";
  const legalPreviewName = legalName || "Your Legal Business Name";
  const trademarkPresets: { id: TrademarkFormat; text: string }[] = [
    { id: "brand", text: `© ${CURRENT_YEAR} ${brandPreviewName} | All Rights Reserved` },
    { id: "legal", text: `© ${CURRENT_YEAR} ${legalPreviewName} | All Rights Reserved` },
  ];

  async function handleSave() {
    setSaving(true);
    try {
      let nextLogoUrl = logoUrl;
      if (logoFile) {
        const uploaded = await uploadShopLogo(logoFile);
        nextLogoUrl = uploaded.url;
      }
      await updateShop({
        name,
        displayName,
        legalName,
        trademarkFormat,
        logoUrl: nextLogoUrl,
        email: email.trim() || undefined,
        whatsappCountryCode,
        whatsappNumber,
        description,
        country,
        address,
        timezone,
        notifyWhatsapp,
        notifyCustomersWhatsapp,
        notifyEmail,
        notifyAbandonedCart,
        abandonedCartWindowMinutes,
        notifyLowStockDigest,
        autoDeductIngredientStock,
      });
      toast("Business settings saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save business settings", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!shop) return <p className="text-sm text-zinc-500">Loading…</p>;

  return (
    // "wide", not "form" — this page's own Card already manages a real
    // grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 layout for Display Name/
    // Business Name/Legal Name etc. (see PageShell.tsx's own doc comment:
    // "wide" is for pages whose content already manages its own internal
    // grid). "form"'s max-w-3xl cap meant those 3 columns had to fit inside
    // a 768px box (~240px each including gaps) instead of real page width —
    // same PageShell variant-misclassification bug fixed elsewhere (Theme
    // Advanced tab, Store Configuration — see that page for the same "wide,
    // no extra inner cap" pattern this now matches), just missed here.
    <PageShell variant="wide">
      <div className="space-y-4">
      <PublishCard shop={shop} onChange={(published) => setShop((s) => (s ? { ...s, published } : s))} />

      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="sm:col-span-2 lg:col-span-3">
            <ImageDropzone preview={logoPreview} onFileSelected={handleLogoSelected} />
          </div>

          <Input label="Display Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <Input label="Business / Brand Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input label="Legal Business Name" value={legalName} onChange={(e) => setLegalName(e.target.value)} />

          <div className="sm:col-span-2 lg:col-span-3">
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
              Trademark / Copyright format
            </label>
            <div className="space-y-2">
              {trademarkPresets.map((preset) => (
                <label
                  key={preset.id}
                  className={`flex items-center gap-3 rounded-lg border p-3 text-sm cursor-pointer transition-colors ${
                    trademarkFormat === preset.id
                      ? "border-black/40 dark:border-white/40 bg-black/[0.02] dark:bg-white/[0.03]"
                      : "border-black/15 dark:border-white/15 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                  }`}
                >
                  <input
                    type="radio"
                    name="trademarkFormat"
                    className="accent-black dark:accent-white shrink-0"
                    checked={trademarkFormat === preset.id}
                    onChange={() => setTrademarkFormat(preset.id)}
                  />
                  {preset.text}
                </label>
              ))}
            </div>
          </div>

          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />

          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
              WhatsApp Number
            </label>
            <div className="flex gap-2">
              <select
                value={whatsappCountryCode}
                onChange={(e) => setWhatsappCountryCode(e.target.value)}
                className="h-9 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-2 text-sm outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
              >
                {WHATSAPP_COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <input
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
              />
            </div>
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <Input label="Country" value={country} onChange={(e) => setCountry(e.target.value)} />

          <div className="sm:col-span-2 lg:col-span-3">
            <Textarea label="Address" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
          </div>

          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
              Time Zone
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <Card>
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
          Notification Settings
        </p>
        <p className="text-xs text-zinc-400 mb-3">
          &quot;Notify Customers via WhatsApp&quot; and &quot;Allow Email Notifications&quot; send real order-confirmation
          and delivery/pickup updates to customers. &quot;Allow WhatsApp Notifications&quot; only saves a preference —
          it doesn&apos;t control customer messaging.
        </p>
        <div className="space-y-2">
          <Checkbox
            label="Allow WhatsApp Notifications"
            checked={notifyWhatsapp}
            onChange={(e) => setNotifyWhatsapp(e.target.checked)}
          />
          <Checkbox
            label="Notify Customers via WhatsApp"
            checked={notifyCustomersWhatsapp}
            onChange={(e) => setNotifyCustomersWhatsapp(e.target.checked)}
          />
          <Checkbox
            label="Allow Email Notifications"
            checked={notifyEmail}
            onChange={(e) => setNotifyEmail(e.target.checked)}
          />
        </div>
      </Card>

      <Card>
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Growth &amp; Alerts</p>
        <p className="text-xs text-zinc-400 mb-3">
          Both off by default — these email potential/at-risk situations (an incomplete purchase, a running-low
          shelf), not existing-customer order updates, so they get their own deliberate opt-in.
        </p>
        <div className="space-y-3">
          <div>
            <Checkbox
              label="Send abandoned cart recovery emails"
              checked={notifyAbandonedCart}
              onChange={(e) => setNotifyAbandonedCart(e.target.checked)}
            />
            {notifyAbandonedCart && (
              <div className="mt-2 ml-6 max-w-40">
                <Input
                  label="Wait before sending (minutes)"
                  type="number"
                  min={1}
                  value={abandonedCartWindowMinutes}
                  onChange={(e) => setAbandonedCartWindowMinutes(Number(e.target.value))}
                />
              </div>
            )}
          </div>
          <Checkbox
            label="Send a daily low-stock summary email"
            checked={notifyLowStockDigest}
            onChange={(e) => setNotifyLowStockDigest(e.target.checked)}
          />
        </div>
      </Card>

      <Card>
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Inventory</p>
        <Checkbox
          label="Auto-deduct ingredient stock on order completion"
          checked={autoDeductIngredientStock}
          onChange={(e) => setAutoDeductIngredientStock(e.target.checked)}
        />
        <p className="text-xs text-zinc-400 mt-1.5 ml-6">
          On by default. When a product has a recipe linked (Inventory &gt; Products), completing an order
          automatically deducts the linked ingredients&apos; stock at the fulfilling branch. Turn this off to keep
          recipe data for costing purposes only, without the system touching ingredient counts.
        </p>
      </Card>

      <WhatsAppCredentialsCard />

      <Button variant="primary" onClick={handleSave} disabled={saving}>
        <Check className="size-4 inline -mt-0.5 mr-1" />
        Save changes
      </Button>
      </div>
    </PageShell>
  );
}
