"use client";

import { useEffect, useState } from "react";
import { getAnalyticsSettings, updateAnalyticsSettings } from "@/lib/api";
import type { AnalyticsSettings, AnalyticsSettingsUpdate } from "@/lib/types";
import { analyticsIdError, type AnalyticsIdField } from "@/lib/analytics-ids";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import SecretField from "@/components/ui/SecretField";
import Button from "@/components/ui/Button";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";

type FieldValues = Record<AnalyticsIdField, string>;

const EMPTY: FieldValues = {
  ga4MeasurementId: "",
  metaPixelId: "",
  metaTestEventCode: "",
  tiktokPixelId: "",
  snapPixelId: "",
  googleAdsConversionId: "",
  googleAdsConversionLabel: "",
};

function toValues(s: AnalyticsSettings): FieldValues {
  return {
    ga4MeasurementId: s.ga4MeasurementId ?? "",
    metaPixelId: s.metaPixelId ?? "",
    metaTestEventCode: s.metaTestEventCode ?? "",
    tiktokPixelId: s.tiktokPixelId ?? "",
    snapPixelId: s.snapPixelId ?? "",
    googleAdsConversionId: s.googleAdsConversionId ?? "",
    googleAdsConversionLabel: s.googleAdsConversionLabel ?? "",
  };
}

export default function AnalyticsIntegrationsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<AnalyticsSettings | null>(null);
  const [values, setValues] = useState<FieldValues>(EMPTY);
  // Write-only: only ever holds what the merchant is typing right now.
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    getAnalyticsSettings()
      .then((s) => {
        setSettings(s);
        setValues(toValues(s));
      })
      .catch((err) => toast(err instanceof Error ? err.message : "Failed to load analytics settings", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (field: AnalyticsIdField) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((prev) => ({ ...prev, [field]: e.target.value }));
  const err = (field: AnalyticsIdField) => (showErrors ? analyticsIdError(field, values[field]) : undefined);

  async function save(extra: AnalyticsSettingsUpdate = {}) {
    setShowErrors(true);
    const invalid = (Object.keys(values) as AnalyticsIdField[]).some((f) => analyticsIdError(f, values[f]));
    if (invalid) {
      toast("Fix the highlighted fields first", "error");
      return;
    }
    const body: AnalyticsSettingsUpdate = { ...extra };
    for (const f of Object.keys(values) as AnalyticsIdField[]) {
      // Empty means "clear it": the API takes null for that.
      body[f] = values[f].trim() === "" ? null : values[f].trim();
    }
    if (token.trim() && body.metaCapiToken === undefined) body.metaCapiToken = token.trim();
    setSaving(true);
    try {
      const updated = await updateAnalyticsSettings(body);
      setSettings(updated);
      setValues(toValues(updated));
      setToken("");
      setShowErrors(false);
      toast("Analytics settings saved");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save analytics settings", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
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
        <Card>
          <h3 className="text-sm font-semibold">How this works</h3>
          <p className="text-xs text-text-faint mt-1">
            Add your ad and analytics ids and your storefront reports page views, add to cart, checkout and
            purchases to each platform. Nothing loads for a visitor until they accept the cookie banner,
            and only the platforms you fill in here are ever contacted. Server side purchase events to Meta
            are sent only for orders where the shopper accepted marketing cookies.
          </p>
        </Card>

        <Card className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Google Analytics 4 and Google Ads</h3>
            <p className="text-xs text-text-faint mt-1">
              The measurement id is in GA4 under Admin, Data streams. The Ads conversion id and label are on
              your conversion action in Google Ads.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Input label="GA4 measurement id" value={values.ga4MeasurementId} onChange={set("ga4MeasurementId")} placeholder="G-XXXXXXXXXX" error={err("ga4MeasurementId")} />
            <Input label="Google Ads conversion id" value={values.googleAdsConversionId} onChange={set("googleAdsConversionId")} placeholder="AW-123456789" error={err("googleAdsConversionId")} />
            <Input label="Google Ads conversion label" value={values.googleAdsConversionLabel} onChange={set("googleAdsConversionLabel")} placeholder="AbC_dEf-123" error={err("googleAdsConversionLabel")} />
          </div>
        </Card>

        <Card className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Meta (Facebook and Instagram)</h3>
            <p className="text-xs text-text-faint mt-1">
              The pixel id loads the browser pixel. Add an access token as well to send purchases from our
              server, which keeps conversions reported when a browser blocks the pixel. The token is
              stored encrypted and is never shown again.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Pixel id" value={values.metaPixelId} onChange={set("metaPixelId")} placeholder="123456789012345" error={err("metaPixelId")} />
            <Input label="Test event code (optional)" value={values.metaTestEventCode} onChange={set("metaTestEventCode")} placeholder="TEST12345" error={err("metaTestEventCode")} tooltip="Sends server events to the Test Events tab in Meta Events Manager. Remove it when you go live." />
            <div className="sm:col-span-2">
              <SecretField
                label="Conversions API access token"
                masked={settings.metaCapiTokenSet ? "Saved (hidden)" : null}
                value={token}
                onChange={setToken}
                placeholder="Paste your access token"
              />
            </div>
          </div>
          {settings.metaCapiTokenSet && (
            <div className="flex justify-start">
              <Button variant="secondary" size="sm" disabled={saving} onClick={() => {
                if (confirm("Remove the saved Meta access token? Server side purchase events will stop.")) void save({ metaCapiToken: null });
              }}>
                Remove token
              </Button>
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">TikTok</h3>
              <p className="text-xs text-text-faint mt-1">The pixel code from TikTok Events Manager.</p>
            </div>
            <Input label="Pixel code" value={values.tiktokPixelId} onChange={set("tiktokPixelId")} placeholder="CXXXXXXXXXXXXXXXXXXX" error={err("tiktokPixelId")} />
          </Card>
          <Card className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Snapchat</h3>
              <p className="text-xs text-text-faint mt-1">The pixel id from Snap Ads Manager.</p>
            </div>
            <Input label="Pixel id" value={values.snapPixelId} onChange={set("snapPixelId")} placeholder="1b2c3d4e-0000-4000-8000-123456789abc" error={err("snapPixelId")} />
          </Card>
        </div>

        <div className="flex justify-end">
          <Button variant="primary" onClick={() => void save()} disabled={saving} loading={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
