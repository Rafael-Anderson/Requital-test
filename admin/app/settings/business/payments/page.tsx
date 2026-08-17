"use client";

import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { API_URL, getPaymentSettings, updatePaymentProvider } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  CARD_PROCESSOR_PROVIDERS,
  PAYMENT_PROVIDER_LABELS,
  PROVIDER_CREDENTIAL_FIELDS,
  type PaymentGatewayProvider,
  type PaymentProviderSettings,
} from "@/lib/types";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Toggle from "@/components/ui/Toggle";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";

const INDEPENDENT_PROVIDERS: PaymentGatewayProvider[] = ["paypal", "tabby", "tamara"];

// Only relevant once a shop has saved its own Stripe secretKey — the
// platform-wide /payments/webhook/stripe route (no shopId) keeps working
// for everyone else. Pointing Stripe's own Dashboard webhook config at
// *this* URL is what lets PaymentsService resolve this shop's webhookSecret
// before verifying, instead of the platform's — see backend
// stripe-payment.provider.ts.
function StripeWebhookInstructions({ shopId }: { shopId: number }) {
  const toast = useToast();
  const url = `${API_URL}/payments/webhook/stripe/${shopId}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast("Webhook URL copied");
    } catch {
      toast("Could not copy URL", "error");
    }
  }

  return (
    <div className="rounded-lg border border-border dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] p-3 space-y-2">
      <p className="text-xs font-medium text-text-secondary dark:text-zinc-300">
        Using your own Stripe account? Add this URL as a webhook endpoint in your Stripe Dashboard
        (Developers → Webhooks), then paste the signing secret it gives you into the Webhook Secret field above.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-surface dark:bg-zinc-900 border border-border dark:border-white/10 rounded px-2 py-1.5 overflow-x-auto whitespace-nowrap">
          {url}
        </code>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 text-xs text-accent-text dark:text-accent hover:underline cursor-pointer shrink-0"
        >
          <Copy className="size-3" />
          Copy
        </button>
      </div>
    </div>
  );
}

// Shopify-style bring-your-own-keys: the merchant's own API credentials,
// entered here and stored encrypted — not a global platform credential, and
// not Dukany's "install a provider app" model. See backend
// PaymentSettingsService for the exclusivity enforcement (this UI making
// the choice a radio, not two toggles, is a UX nicety on top of that real
// server-side check — a direct API call is blocked there regardless of
// what this page does).
function CredentialFields({
  provider,
  values,
  maskedCredentials,
  onChange,
}: {
  provider: PaymentGatewayProvider;
  values: Record<string, string>;
  maskedCredentials: Record<string, string> | null;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="space-y-3">
      {PROVIDER_CREDENTIAL_FIELDS[provider].map((field) => (
        <div key={field.key}>
          <Input
            label={field.label}
            type="password"
            autoComplete="off"
            value={values[field.key] ?? ""}
            onChange={(e) => onChange(field.key, e.target.value)}
            placeholder={maskedCredentials?.[field.key] ? "Leave blank to keep current value" : undefined}
          />
          {maskedCredentials?.[field.key] && (
            <p className="mt-1 text-xs text-text-faint">Currently saved: {maskedCredentials[field.key]}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export default function PaymentGatewaysPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [settings, setSettings] = useState<PaymentProviderSettings[] | null>(null);

  const [cardProcessor, setCardProcessor] = useState<PaymentGatewayProvider>("stripe");
  const [cardCredentials, setCardCredentials] = useState<Record<string, string>>({});
  const [savingCard, setSavingCard] = useState(false);

  const [independentCredentials, setIndependentCredentials] = useState<
    Record<string, Record<string, string>>
  >({});
  const [independentEnabled, setIndependentEnabled] = useState<Record<string, boolean>>({});
  const [savingProvider, setSavingProvider] = useState<string | null>(null);

  const [codEnabled, setCodEnabled] = useState(false);
  const [savingCod, setSavingCod] = useState(false);

  async function refresh() {
    const rows = await getPaymentSettings();
    setSettings(rows);
    const activeCardProcessor = rows.find((r) => r.isCardProcessor && r.enabled);
    setCardProcessor((activeCardProcessor?.provider as PaymentGatewayProvider) ?? "stripe");
    setCardCredentials({});

    const nextEnabled: Record<string, boolean> = {};
    for (const provider of INDEPENDENT_PROVIDERS) {
      nextEnabled[provider] = rows.find((r) => r.provider === provider)?.enabled ?? false;
    }
    setIndependentEnabled(nextEnabled);
    setIndependentCredentials({});

    setCodEnabled(rows.find((r) => r.provider === "cod")?.enabled ?? false);
  }

  useEffect(() => {
    refresh();
  }, []);

  function rowFor(provider: string) {
    return settings?.find((r) => r.provider === provider) ?? null;
  }

  async function handleSaveCardProcessor() {
    setSavingCard(true);
    try {
      const currentlyActive = settings?.find((r) => r.isCardProcessor && r.enabled)?.provider;
      // The exclusivity rule (PaymentSettingsService) rejects enabling one
      // card processor while the other is still active, rather than
      // auto-disabling it — so switching from the UI means disabling the
      // old one first, then enabling the new one, as two calls. Direct API
      // callers still hit the real check regardless of this UI sequencing.
      if (currentlyActive && currentlyActive !== cardProcessor) {
        await updatePaymentProvider(currentlyActive, { enabled: false });
      }
      const credentials = Object.keys(cardCredentials).length > 0 ? cardCredentials : undefined;
      await updatePaymentProvider(cardProcessor, { enabled: true, ...(credentials && { credentials }) });
      toast(`${PAYMENT_PROVIDER_LABELS[cardProcessor]} is now your card processor`);
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save card processor", "error");
    } finally {
      setSavingCard(false);
    }
  }

  async function handleSaveIndependent(provider: PaymentGatewayProvider) {
    setSavingProvider(provider);
    try {
      const credentials = independentCredentials[provider];
      const hasNewCredentials = credentials && Object.keys(credentials).length > 0;
      await updatePaymentProvider(provider, {
        enabled: independentEnabled[provider] ?? false,
        ...(hasNewCredentials && { credentials }),
      });
      toast(`${PAYMENT_PROVIDER_LABELS[provider]} saved`);
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : `Failed to save ${PAYMENT_PROVIDER_LABELS[provider]}`, "error");
    } finally {
      setSavingProvider(null);
    }
  }

  async function handleToggleCod(next: boolean) {
    setSavingCod(true);
    try {
      await updatePaymentProvider("cod", { enabled: next });
      setCodEnabled(next);
      toast("Cash on Delivery updated");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update Cash on Delivery", "error");
    } finally {
      setSavingCod(false);
    }
  }

  if (!settings) {
    return (
      <div className="space-y-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <PageShell variant="form">
      <div className="space-y-4">
      <Card className="space-y-4">
        <div>
          <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">Card processing</h3>
          <p className="text-xs text-text-faint mt-1">
            Choose one. Nomod and Stripe can&apos;t both be active at the same time.
          </p>
        </div>
        <div className="space-y-2">
          {CARD_PROCESSOR_PROVIDERS.map((provider) => (
            <label
              key={provider}
              className={`flex items-center gap-3 rounded-lg border p-3 text-sm cursor-pointer transition-colors ${
                cardProcessor === provider
                  ? "border-black/40 dark:border-white/40 bg-black/[0.02] dark:bg-white/[0.03]"
                  : "border-border dark:border-white/15 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
              }`}
            >
              <input
                type="radio"
                name="cardProcessor"
                className="accent-black dark:accent-white shrink-0"
                checked={cardProcessor === provider}
                onChange={() => setCardProcessor(provider)}
              />
              <span className="font-medium">{PAYMENT_PROVIDER_LABELS[provider]}</span>
              {rowFor(provider)?.enabled && (
                <span className="ml-auto text-xs text-green-600 dark:text-green-400 font-medium">Active</span>
              )}
            </label>
          ))}
        </div>
        <CredentialFields
          provider={cardProcessor}
          values={cardCredentials}
          maskedCredentials={rowFor(cardProcessor)?.maskedCredentials ?? null}
          onChange={(key, value) => setCardCredentials((prev) => ({ ...prev, [key]: value }))}
        />
        {cardProcessor === "stripe" && user && <StripeWebhookInstructions shopId={user.shopId} />}
        <div className="flex justify-end">
          <Button variant="primary" onClick={handleSaveCardProcessor} disabled={savingCard}>
            {savingCard ? "Saving…" : "Save card processor"}
          </Button>
        </div>
      </Card>

      {INDEPENDENT_PROVIDERS.map((provider) => (
        <Card key={provider} className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">{PAYMENT_PROVIDER_LABELS[provider]}</h3>
              <p className="text-xs text-text-faint mt-1">Independent of card processing, enable it on its own.</p>
            </div>
            <Toggle
              checked={independentEnabled[provider] ?? false}
              onChange={(checked) => setIndependentEnabled((prev) => ({ ...prev, [provider]: checked }))}
              tooltip={`Makes ${PAYMENT_PROVIDER_LABELS[provider]} available as a payment option at checkout.`}
            />
          </div>
          <CredentialFields
            provider={provider}
            values={independentCredentials[provider] ?? {}}
            maskedCredentials={rowFor(provider)?.maskedCredentials ?? null}
            onChange={(key, value) =>
              setIndependentCredentials((prev) => ({
                ...prev,
                [provider]: { ...prev[provider], [key]: value },
              }))
            }
          />
          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={() => handleSaveIndependent(provider)}
              disabled={savingProvider === provider}
            >
              {savingProvider === provider ? "Saving…" : "Save"}
            </Button>
          </div>
        </Card>
      ))}

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">Cash on Delivery</h3>
            <p className="text-xs text-text-faint mt-1">
              No API key needed, just a visibility toggle. Sets both delivery and pickup Cash on Delivery
              together (see Outlets for finer per-context control).
            </p>
          </div>
          <Toggle checked={codEnabled} onChange={handleToggleCod} disabled={savingCod} />
        </div>
      </Card>
      </div>
    </PageShell>
  );
}
