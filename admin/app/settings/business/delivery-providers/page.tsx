"use client";

import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { API_URL, clearSliderSettings, getSliderSettings, updateSliderSettings } from "@/lib/api";
import type { SliderSettings } from "@/lib/types";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";

// Slider is the one real courier API integration in this app (contrast the
// manual "Log external delivery" flow on an order, which has no API behind
// it) — see backend delivery-providers/. Sandbox-only in practice today
// (SliderDeliveryProvider's base URL is picked from this environment field,
// but nothing in this codebase has a verified production key to test
// against yet), production is still offered here since the backend/DTO
// already support it.
export default function DeliveryProvidersPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<SliderSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [webhookToken, setWebhookToken] = useState("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function refresh() {
    const res = await getSliderSettings();
    setSettings(res);
    setAccountId(res.accountId ?? "");
    setEnvironment(res.environment ?? "sandbox");
    setApiKey("");
    setWebhookToken("");
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSave() {
    if (!accountId.trim()) {
      toast("Account ID is required", "error");
      return;
    }
    if (!settings?.hasCredentials && !apiKey.trim()) {
      toast("API Key is required", "error");
      return;
    }
    setSaving(true);
    try {
      await updateSliderSettings({
        apiKey: apiKey.trim() || undefined,
        accountId: accountId.trim(),
        webhookToken: webhookToken.trim() || undefined,
        environment,
      });
      toast("Slider settings saved");
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save Slider settings", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!confirm("Remove the saved Slider credentials for this shop?")) return;
    setClearing(true);
    try {
      await clearSliderSettings();
      toast("Slider credentials removed");
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to remove Slider settings", "error");
    } finally {
      setClearing(false);
    }
  }

  async function copyWebhookUrl() {
    try {
      await navigator.clipboard.writeText(`${API_URL}/slider/webhook`);
      toast("Webhook URL copied");
    } catch {
      toast("Could not copy URL", "error");
    }
  }

  if (!settings) {
    return (
      <div className="space-y-4">
        <CardSkeleton />
      </div>
    );
  }

  return (
    <PageShell variant="form">
      <div className="space-y-4">
        <Card className="space-y-4">
          <div>
            <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">Slider</h3>
            <p className="text-xs text-text-faint mt-1">
              On-demand courier dispatch, directly from an order&apos;s detail view. Bring your own Slider
              account credentials below.
            </p>
          </div>

          <SegmentedToggle
            value={environment}
            onChange={setEnvironment}
            options={[
              { value: "sandbox", label: "Sandbox" },
              { value: "production", label: "Production" },
            ]}
          />

          <Input label="Account ID" value={accountId} onChange={(e) => setAccountId(e.target.value)} />

          <div>
            <Input
              label="API Key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings.maskedApiKey ? "Leave blank to keep current value" : undefined}
            />
            {settings.maskedApiKey && (
              <p className="mt-1 text-xs text-text-faint">Currently saved: {settings.maskedApiKey}</p>
            )}
          </div>

          <div>
            <Input
              label="Webhook token (optional)"
              type="password"
              autoComplete="off"
              value={webhookToken}
              onChange={(e) => setWebhookToken(e.target.value)}
              placeholder={settings.hasWebhookToken ? "Leave blank to keep current value" : "No auth if left blank"}
            />
            {settings.hasWebhookToken && (
              <p className="mt-1 text-xs text-text-faint">A webhook token is currently saved.</p>
            )}
          </div>

          <div className="rounded-lg border border-border dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] p-3 space-y-2">
            <p className="text-xs font-medium text-text-secondary dark:text-zinc-300">
              Paste this URL into Slider&apos;s dashboard as the delivery status webhook. If you set a
              webhook token above, configure Slider to send it back in an{" "}
              <code className="text-[11px]">X-Slider-Webhook-Token</code> header.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-surface dark:bg-zinc-900 border border-border dark:border-white/10 rounded px-2 py-1.5 overflow-x-auto whitespace-nowrap">
                {API_URL}/slider/webhook
              </code>
              <button
                type="button"
                onClick={copyWebhookUrl}
                className="flex items-center gap-1 text-xs text-accent-text dark:text-accent hover:underline cursor-pointer shrink-0"
              >
                <Copy className="size-3" />
                Copy
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            {settings.hasCredentials ? (
              <Button variant="secondary" size="sm" onClick={handleClear} disabled={clearing} loading={clearing}>
                Remove credentials
              </Button>
            ) : (
              <span />
            )}
            <Button variant="primary" onClick={handleSave} disabled={saving} loading={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
