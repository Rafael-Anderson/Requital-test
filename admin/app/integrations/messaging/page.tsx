"use client";

import { useEffect, useState } from "react";
import {
  clearWhatsAppCredentials,
  getShop,
  getWhatsAppSettings,
  sendWhatsAppTestMessage,
  setWhatsAppCredentials,
  updateShop,
} from "@/lib/api";
import { WHATSAPP_CREDENTIAL_FIELDS, type Shop, type WhatsAppSettings } from "@/lib/types";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import SecretField from "@/components/ui/SecretField";
import Button from "@/components/ui/Button";
import Toggle from "@/components/ui/Toggle";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";

// UAE-focused dial codes — this is a UAE-market product, not a general
// international directory. Moved here verbatim from Business Information's
// old WhatsApp Number field (see CLAUDE.md's Messaging tab migration note).
const WHATSAPP_COUNTRY_CODES = [
  "+971", "+966", "+965", "+974", "+973", "+968", "+91", "+92", "+1", "+44",
];

export default function MessagingIntegrationsPage() {
  const toast = useToast();
  const [shop, setShop] = useState<Shop | null>(null);
  const [countryCode, setCountryCode] = useState("+971");
  const [number, setNumber] = useState("");
  const [notifyCustomers, setNotifyCustomers] = useState(false);
  const [floatingButton, setFloatingButton] = useState(false);
  const [savingNumber, setSavingNumber] = useState(false);

  const [credentials, setCredentials] = useState<WhatsAppSettings | null>(null);
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [savingCredentials, setSavingCredentials] = useState(false);

  const [testNumber, setTestNumber] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  async function refresh() {
    const [s, c] = await Promise.all([getShop(), getWhatsAppSettings()]);
    setShop(s);
    setCountryCode(s.whatsappCountryCode ?? "+971");
    setNumber(s.whatsappNumber ?? "");
    setNotifyCustomers(s.notifyCustomersWhatsapp);
    setFloatingButton(s.whatsappFloatingButtonEnabled);
    setCredentials(c);
    setCredentialValues({});
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSaveNumberAndToggles() {
    setSavingNumber(true);
    try {
      const updated = await updateShop({
        whatsappCountryCode: countryCode,
        whatsappNumber: number,
        notifyCustomersWhatsapp: notifyCustomers,
        whatsappFloatingButtonEnabled: floatingButton,
      });
      setShop(updated);
      toast("WhatsApp settings saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save WhatsApp settings", "error");
    } finally {
      setSavingNumber(false);
    }
  }

  async function handleSaveCredentials() {
    const phoneNumberId = credentialValues.phoneNumberId?.trim();
    const accessToken = credentialValues.accessToken?.trim();
    if (!phoneNumberId || !accessToken) {
      if (!credentials?.hasCredentials) {
        toast("Enter both Phone Number ID and Access Token", "error");
        return;
      }
    }
    setSavingCredentials(true);
    try {
      const updated = await setWhatsAppCredentials({
        phoneNumberId: phoneNumberId || "",
        accessToken: accessToken || "",
      });
      setCredentials(updated);
      setCredentialValues({});
      toast("WhatsApp Business API credentials saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save WhatsApp credentials", "error");
    } finally {
      setSavingCredentials(false);
    }
  }

  async function handleClearCredentials() {
    if (!confirm("Remove the saved WhatsApp Business API credentials? Customer WhatsApp notifications will stop sending until reconfigured.")) {
      return;
    }
    setSavingCredentials(true);
    try {
      setCredentials(await clearWhatsAppCredentials());
      toast("WhatsApp credentials removed");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to remove WhatsApp credentials", "error");
    } finally {
      setSavingCredentials(false);
    }
  }

  async function handleSendTest() {
    if (!testNumber.trim()) {
      toast("Enter a phone number to send the test message to", "error");
      return;
    }
    setSendingTest(true);
    try {
      await sendWhatsAppTestMessage(testNumber.trim());
      toast("Test message sent");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to send test message", "error");
    } finally {
      setSendingTest(false);
    }
  }

  if (!shop || !credentials) {
    return (
      <PageShell variant="form">
        <div className="space-y-4">
          <CardSkeleton />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell variant="form">
      <div className="space-y-4">
        <Card className="space-y-4">
          <div>
            <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">WhatsApp</h3>
            <p className="text-xs text-text-faint mt-1">
              Your store&apos;s WhatsApp number, real-time order notifications sent through it via Meta&apos;s
              WhatsApp Business API, and where customers reach you on the storefront.
            </p>
          </div>

          <div>
            <label className="text-[13px] font-semibold text-text-secondary dark:text-zinc-400 block mb-1.5">
              WhatsApp Number
            </label>
            <div className="flex gap-2">
              <select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="h-9 rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-2 text-sm outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
              >
                {WHATSAPP_COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="501234567"
                className="flex h-9 w-full rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-3 py-2 text-sm outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
              />
            </div>
            <p className="mt-1 text-xs text-text-faint">
              Used for the storefront&apos;s WhatsApp button and any &quot;Contact to order&quot; checkout flow.
            </p>
          </div>

          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-secondary dark:text-zinc-300">
                  Notify customers via WhatsApp
                </p>
                <p className="text-xs text-text-faint mt-0.5">
                  Sends real order-confirmation and delivery/pickup update messages to customers.
                </p>
              </div>
              <Toggle checked={notifyCustomers} onChange={setNotifyCustomers} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-secondary dark:text-zinc-300">
                  WhatsApp floating button
                </p>
                <p className="text-xs text-text-faint mt-0.5">
                  Shows a floating chat button on your storefront that opens a WhatsApp chat to the number
                  above.
                  {!number && " Set a WhatsApp number above for it to work."}
                </p>
              </div>
              <Toggle checked={floatingButton} onChange={setFloatingButton} />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button variant="primary" onClick={handleSaveNumberAndToggles} disabled={savingNumber} loading={savingNumber}>
              {savingNumber ? "Saving…" : "Save"}
            </Button>
          </div>
        </Card>

        <Card className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">WhatsApp Business API</h3>
            <p className="text-xs text-text-faint mt-1">
              Meta WhatsApp Cloud API credentials, used to send the notifications above. Business
              verification and number setup happen in Meta&apos;s own Business Manager, then paste the
              resulting values here.
              {!credentials.hasCredentials && " Without these, notifications fall back to a console log only (dev/testing)."}
            </p>
          </div>
          <div className="space-y-3">
            {WHATSAPP_CREDENTIAL_FIELDS.map((field) => (
              <SecretField
                key={field.key}
                label={field.label}
                masked={credentials.maskedCredentials?.[field.key] ?? null}
                value={credentialValues[field.key] ?? ""}
                onChange={(value) => setCredentialValues((prev) => ({ ...prev, [field.key]: value }))}
              />
            ))}
          </div>
          <div className="flex items-center justify-between pt-1">
            {credentials.hasCredentials ? (
              <Button variant="secondary" size="sm" onClick={handleClearCredentials} disabled={savingCredentials}>
                Remove
              </Button>
            ) : (
              <span />
            )}
            <Button variant="primary" onClick={handleSaveCredentials} disabled={savingCredentials} loading={savingCredentials}>
              {savingCredentials ? "Saving…" : "Save WhatsApp credentials"}
            </Button>
          </div>

          {credentials.hasCredentials && (
            <div className="flex items-end gap-2 pt-3 border-t border-gray-200 dark:border-white/10">
              <Input
                label="Send test message to"
                value={testNumber}
                onChange={(e) => setTestNumber(e.target.value)}
                placeholder="+971501234567"
                wrapperClassName="flex-1"
              />
              <Button variant="secondary" onClick={handleSendTest} disabled={sendingTest} loading={sendingTest}>
                {sendingTest ? "Sending…" : "Send test message"}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
