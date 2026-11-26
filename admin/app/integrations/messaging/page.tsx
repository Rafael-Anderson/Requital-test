"use client";

import { useEffect, useRef, useState } from "react";
import {
  clearWhatsAppCredentials,
  getShop,
  getWhatsAppSettings,
  sendWhatsAppTestMessage,
  setWhatsAppCredentials,
  testWhatsAppConnection,
  ApiError,
  updateShop,
} from "@/lib/api";
import {
  WHATSAPP_CREDENTIAL_FIELDS,
  type MetaErrorDetails,
  type Shop,
  type WhatsAppConnectionTest,
  type WhatsAppSettings,
} from "@/lib/types";
import { sanitizeCredentialValue, whatsappCredentialProblems } from "@/lib/whatsapp-credentials";
import WhatsAppConnectionResult, { MetaErrorDetailsBlock } from "@/components/WhatsAppConnectionResult";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import SecretField from "@/components/ui/SecretField";
import Button from "@/components/ui/Button";
import Toggle from "@/components/ui/Toggle";
import { CardSkeleton } from "@/components/ui/Skeleton";
import LoadFailed from "@/components/ui/LoadFailed";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";
import CardGrid from "@/components/ui/CardGrid";

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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [connection, setConnection] = useState<WhatsAppConnectionTest | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testError, setTestError] = useState<{ message: string; details: MetaErrorDetails | null } | null>(null);

  const [testNumber, setTestNumber] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  // The shop (number and toggles) and the credentials load on independent
  // chains: neither card waits on, or is lost to, the other. Each ends in an
  // error with Try again.
  const [shopError, setShopError] = useState<string | null>(null);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const latestShop = useRef(0);
  const latestCredentials = useRef(0);

  function refreshShop() {
    const mine = ++latestShop.current;
    getShop()
      .then((s) => {
        if (mine !== latestShop.current) return;
        setShop(s);
        setShopError(null);
        setCountryCode(s.whatsappCountryCode ?? "+971");
        setNumber(s.whatsappNumber ?? "");
        setNotifyCustomers(s.notifyCustomersWhatsapp);
        setFloatingButton(s.whatsappFloatingButtonEnabled);
      })
      .catch((err) => {
        if (mine !== latestShop.current) return;
        setShopError(err instanceof Error ? err.message : "Failed to load WhatsApp settings");
      });
  }

  function refreshCredentials() {
    const mine = ++latestCredentials.current;
    getWhatsAppSettings()
      .then((c) => {
        if (mine !== latestCredentials.current) return;
        setCredentials(c);
        setCredentialsError(null);
        setCredentialValues({});
      })
      .catch((err) => {
        if (mine !== latestCredentials.current) return;
        setCredentialsError(err instanceof Error ? err.message : "Failed to load WhatsApp credentials");
      });
  }

  useEffect(() => {
    refreshShop();
    refreshCredentials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Pasted invisible characters (Meta Business Manager adds U+2069 after a
    // Phone Number ID) are removed here and again on the server.
    const phoneNumberId = sanitizeCredentialValue(credentialValues.phoneNumberId ?? "");
    const accessToken = sanitizeCredentialValue(credentialValues.accessToken ?? "");
    const problems = whatsappCredentialProblems({ phoneNumberId, accessToken });
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setSavingCredentials(true);
    setConnection(null);
    try {
      const updated = await setWhatsAppCredentials({ phoneNumberId, accessToken });
      setCredentials(updated);
      setCredentialValues({});
      // The automatic Test connection ran on save (saving is never blocked by it).
      if (updated.connectionTest) setConnection(updated.connectionTest);
      toast("WhatsApp Business API credentials saved");
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) setFieldErrors(err.fieldErrors);
      toast(err instanceof Error ? err.message : "Failed to save WhatsApp credentials", "error");
    } finally {
      setSavingCredentials(false);
    }
  }

  async function handleTestConnection() {
    setTestingConnection(true);
    try {
      setConnection(await testWhatsAppConnection());
    } catch (err) {
      setConnection({
        ok: false,
        reason: "request_failed",
        message: err instanceof Error ? err.message : "Could not test the connection",
        details: null,
      });
    } finally {
      setTestingConnection(false);
    }
  }

  async function handleClearCredentials() {
    if (!confirm("Remove the saved WhatsApp Business API credentials? Customer WhatsApp notifications will stop sending until reconfigured.")) {
      return;
    }
    setSavingCredentials(true);
    try {
      setCredentials(await clearWhatsAppCredentials());
      setConnection(null);
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
    setTestError(null);
    try {
      await sendWhatsAppTestMessage(testNumber.trim());
      toast("Test message sent");
    } catch (err) {
      // A friendly sentence; Meta's own message and fbtrace_id sit under Details.
      const message = err instanceof Error ? err.message : "Failed to send test message";
      const details =
        err instanceof ApiError && err.details ? (err.details as MetaErrorDetails) : null;
      setTestError({ message, details });
      toast(message, "error");
    } finally {
      setSendingTest(false);
    }
  }

  return (
    <PageShell variant="wide">
      <CardGrid>
        {!shop ? (
          shopError ? (
            <Card>
              <LoadFailed what="WhatsApp settings" onRetry={refreshShop} />
            </Card>
          ) : (
            <CardSkeleton />
          )
        ) : (
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
        )}

        {!credentials ? (
          credentialsError ? (
            <Card>
              <LoadFailed what="WhatsApp credentials" onRetry={refreshCredentials} />
            </Card>
          ) : (
            <CardSkeleton />
          )
        ) : (
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
                onChange={(value) => {
                  setCredentialValues((prev) => ({ ...prev, [field.key]: value }));
                  setFieldErrors((prev) => ({ ...prev, [field.key]: "" }));
                }}
                error={fieldErrors[field.key] || undefined}
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
            <div className="flex items-center gap-2">
              {credentials.hasCredentials && (
                <Button
                  variant="secondary"
                  onClick={handleTestConnection}
                  disabled={testingConnection || savingCredentials}
                  loading={testingConnection}
                >
                  {testingConnection ? "Testing…" : "Test connection"}
                </Button>
              )}
              <Button variant="primary" onClick={handleSaveCredentials} disabled={savingCredentials} loading={savingCredentials}>
                {savingCredentials ? "Saving…" : "Save WhatsApp credentials"}
              </Button>
            </div>
          </div>
          {connection && (
            <WhatsAppConnectionResult result={connection} countryCode={countryCode} localNumber={number} />
          )}

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
          {testError && (
            <div role="alert" data-testid="whatsapp-test-message-error" className="text-sm text-red-700 dark:text-red-300">
              <p>{testError.message}</p>
              <MetaErrorDetailsBlock details={testError.details} />
            </div>
          )}
        </Card>
        )}
      </CardGrid>
    </PageShell>
  );
}
