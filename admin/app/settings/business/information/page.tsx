"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { getPublishReadiness, getShop, resolveImageUrl, storefrontUrlFor, updateShop, uploadShopLogo } from "@/lib/api";
import type { PublishReadiness, Shop, TrademarkFormat } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import { COUNTRIES } from "@/lib/useAccountSetupForm";
import Checkbox from "@/components/ui/Checkbox";
import Card from "@/components/ui/Card";
import ImageDropzone from "@/components/ui/ImageDropzone";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Toggle from "@/components/ui/Toggle";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";

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
  const tooltip = blocked ? readiness!.missing.join(', ') : undefined;

  return (
    <Card className="flex items-center justify-between gap-4">
      <div>
        <p className="text-[14.5px] font-bold text-text-primary dark:text-zinc-50">{shop.published ? "Store published" : "Publish your store"}</p>
        <p className="text-xs text-text-faint mt-1">
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
          <p className="text-xs mt-1.5 text-text-faint" title="Your store link will be live once published">
            Store link (available once published)
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
  const [description, setDescription] = useState("");
  const [country, setCountry] = useState("");
  // Whether country was already set the moment this page loaded — the
  // field locks server-side once set (ShopService.update), so this is a
  // belt-and-suspenders UI disable, not the real enforcement.
  const [countryLocked, setCountryLocked] = useState(false);
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("Asia/Dubai");
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [notifyAbandonedCart, setNotifyAbandonedCart] = useState(false);
  const [abandonedCartWindowMinutes, setAbandonedCartWindowMinutes] = useState(60);
  const [notifyLowStockDigest, setNotifyLowStockDigest] = useState(false);
  const [autoDeductIngredientStock, setAutoDeductIngredientStock] = useState(true);
  const [productEditorMode, setProductEditorMode] = useState<"simple" | "advanced">("simple");
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
      setDescription(s.description ?? "");
      setCountry(s.country ?? "");
      setCountryLocked(!!s.country);
      setAddress(s.address ?? "");
      setTimezone(s.timezone);
      setNotifyWhatsapp(s.notifyWhatsapp);
      setNotifyEmail(s.notifyEmail);
      setNotifyAbandonedCart(s.notifyAbandonedCart);
      setAbandonedCartWindowMinutes(s.abandonedCartWindowMinutes);
      setNotifyLowStockDigest(s.notifyLowStockDigest);
      setAutoDeductIngredientStock(s.autoDeductIngredientStock);
      setProductEditorMode(s.productEditorMode);
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
        description,
        country,
        address,
        timezone,
        notifyWhatsapp,
        notifyEmail,
        notifyAbandonedCart,
        abandonedCartWindowMinutes,
        notifyLowStockDigest,
        autoDeductIngredientStock,
        productEditorMode,
      });
      toast("Business settings saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save business settings", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!shop) return <p className="text-sm text-text-muted">Loading…</p>;

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
            <label className="text-[13px] font-semibold text-text-secondary dark:text-zinc-400 block mb-1.5">
              Trademark / Copyright format
            </label>
            <div className="space-y-2">
              {trademarkPresets.map((preset) => (
                <label
                  key={preset.id}
                  className={`flex items-center gap-3 rounded-[10px] border p-3 text-[13.5px] cursor-pointer transition-colors ${
                    trademarkFormat === preset.id
                      ? "border-accent bg-[#FAFCFC] dark:border-white/40 dark:bg-white/[0.03]"
                      : "border-border dark:border-white/15 hover:bg-[#FAFCFC] dark:hover:bg-white/[0.03]"
                  }`}
                >
                  <input
                    type="radio"
                    name="trademarkFormat"
                    className="accent-accent shrink-0"
                    checked={trademarkFormat === preset.id}
                    onChange={() => setTrademarkFormat(preset.id)}
                  />
                  {preset.text}
                </label>
              ))}
            </div>
          </div>

          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />

          <div className="sm:col-span-2 lg:col-span-3">
            <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div>
            <Select
              label="Country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              disabled={countryLocked}
            >
              <option value="" disabled>
                Select country
              </option>
              {/* A pre-existing shop's stored value might predate this fixed
                  list (the field used to be free text) — surface it as-is
                  rather than silently blanking the select. */}
              {country && !(COUNTRIES as readonly string[]).includes(country) && (
                <option value={country}>{country}</option>
              )}
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            {countryLocked && (
              <p className="text-xs text-text-muted mt-1">Country is locked once set.</p>
            )}
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <Textarea label="Address" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
          </div>

          <div>
            <label className="text-[13px] font-semibold text-text-secondary dark:text-zinc-400 block mb-1.5">
              Time Zone
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="flex h-9 w-full rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-3 py-2 text-sm outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
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
        <p className="text-[13px] font-semibold text-text-secondary dark:text-zinc-400 mb-2">
          Notification Settings
        </p>
        <p className="text-xs text-text-faint mb-3">
          &quot;Allow Email Notifications&quot; sends real order-confirmation and delivery/pickup updates to
          customers. &quot;Allow WhatsApp Notifications&quot; only saves a preference; it doesn&apos;t control
          customer messaging — see{" "}
          <Link href="/integrations/messaging" className="text-accent-text dark:text-accent hover:underline">
            Integrations &gt; Messaging
          </Link>{" "}
          for the real WhatsApp number, credentials, and customer-notification toggle.
        </p>
        <div className="space-y-2">
          <Checkbox
            label="Allow WhatsApp Notifications"
            checked={notifyWhatsapp}
            onChange={(e) => setNotifyWhatsapp(e.target.checked)}
          />
          <Checkbox
            label="Allow Email Notifications"
            checked={notifyEmail}
            onChange={(e) => setNotifyEmail(e.target.checked)}
          />
        </div>
      </Card>

      <Card>
        <p className="text-[13px] font-semibold text-text-secondary dark:text-zinc-400 mb-2">Growth &amp; Alerts</p>
        <p className="text-xs text-text-faint mb-3">
          Both off by default. These email potential/at-risk situations (an incomplete purchase, a running-low
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
        <p className="text-[13px] font-semibold text-text-secondary dark:text-zinc-400 mb-2">Inventory</p>
        <Checkbox
          label="Auto-deduct ingredient stock on order completion"
          checked={autoDeductIngredientStock}
          onChange={(e) => setAutoDeductIngredientStock(e.target.checked)}
        />
        <p className="text-xs text-text-faint mt-1.5 ml-6">
          On by default. When a product has a recipe linked (Inventory &gt; Products), completing an order
          automatically deducts the linked ingredients&apos; stock at the fulfilling branch. Turn this off to keep
          recipe data for costing purposes only, without the system touching ingredient counts.
        </p>
      </Card>

      <Card>
        <p className="text-[13px] font-semibold text-text-secondary dark:text-zinc-400 mb-2">Product Editor</p>
        <p className="text-xs text-text-faint mb-3">
          Simple starts with a focused form. Variants and extras are off by default but available on any product.
          Advanced shows everything expanded from the start.
        </p>
        <SegmentedToggle
          value={productEditorMode}
          onChange={setProductEditorMode}
          options={[
            { value: "simple", label: "Simple" },
            { value: "advanced", label: "Advanced" },
          ]}
        />
      </Card>

      <Button variant="primary" onClick={handleSave} disabled={saving} loading={saving}>
        <Check className="size-4 inline -mt-0.5 mr-1" />
        Save changes
      </Button>
      </div>
    </PageShell>
  );
}
