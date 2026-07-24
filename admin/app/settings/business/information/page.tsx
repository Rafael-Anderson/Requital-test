"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { getShop, resolveImageUrl, updateShop, uploadShopLogo } from "@/lib/api";
import type { Shop, TrademarkFormat } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Checkbox from "@/components/ui/Checkbox";
import ImageDropzone from "@/components/ui/ImageDropzone";
import { useToast } from "@/components/ui/Toast";

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
    <div className="space-y-5">
      <ImageDropzone preview={logoPreview} onFileSelected={handleLogoSelected} />

      <Input label="Display Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      <Input label="Business / Brand Name" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input label="Legal Business Name" value={legalName} onChange={(e) => setLegalName(e.target.value)} />

      <div>
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
                className="accent-black dark:accent-white"
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
            className="h-9 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-2 text-sm outline-none cursor-pointer transition-shadow focus:border-black/40 dark:focus:border-white/40 focus:ring-[3px] focus:ring-black/10 dark:focus:ring-white/15"
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
            className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-black/40 dark:focus:border-white/40 focus:ring-[3px] focus:ring-black/10 dark:focus:ring-white/15"
          />
        </div>
      </div>

      <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />

      <Input label="Country" value={country} onChange={(e) => setCountry(e.target.value)} />
      <Textarea label="Address" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />

      <div>
        <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
          Time Zone
        </label>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-black/40 dark:focus:border-white/40 focus:ring-[3px] focus:ring-black/10 dark:focus:ring-white/15"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
          Notification Settings
        </p>
        <p className="text-xs text-zinc-400 mb-3">
          These only save a preference — no WhatsApp or email integration is connected yet.
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
      </div>

      <Button variant="primary" onClick={handleSave} disabled={saving}>
        <Check className="size-4 inline -mt-0.5 mr-1" />
        Save changes
      </Button>
    </div>
  );
}
