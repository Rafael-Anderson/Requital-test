"use client";

import { useEffect, useState } from "react";
import { getAnalyticsSettings, updateAnalyticsSettings } from "@/lib/api";
import type { AnalyticsSettings, AnalyticsSettingsUpdate, AnalyticsTokenKey } from "@/lib/types";
import { analyticsIdError, type AnalyticsIdField } from "@/lib/analytics-ids";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import SecretField from "@/components/ui/SecretField";
import Button from "@/components/ui/Button";
import { CardSkeleton } from "@/components/ui/Skeleton";
import LoadFailed from "@/components/ui/LoadFailed";
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

const TOKEN_KEYS: AnalyticsTokenKey[] = ["metaCapiToken", "tiktokEventsToken", "snapCapiToken"];
const NO_TOKENS: Record<AnalyticsTokenKey, string> = { metaCapiToken: "", tiktokEventsToken: "", snapCapiToken: "" };

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

// A write-only secret: masked once saved, Replace to type a new one, Remove (with
// a confirm) to clear it.
function TokenField(props: {
  label: string;
  placeholder: string;
  isSet: boolean;
  value: string;
  onChange: (v: string) => void;
  saving: boolean;
  removeMessage: string;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2">
      <SecretField
        label={props.label}
        masked={props.isSet ? "Saved (hidden)" : null}
        value={props.value}
        onChange={props.onChange}
        placeholder={props.placeholder}
      />
      {props.isSet && (
        <div className="flex justify-start">
          <Button
            variant="secondary"
            size="sm"
            disabled={props.saving}
            onClick={() => {
              if (confirm(props.removeMessage)) props.onRemove();
            }}
          >
            Remove token
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AnalyticsIntegrationsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<AnalyticsSettings | null>(null);
  const [values, setValues] = useState<FieldValues>(EMPTY);
  // Write-only: only ever holds what the merchant is typing right now.
  const [tokens, setTokens] = useState(NO_TOKENS);
  const setToken = (key: AnalyticsTokenKey) => (v: string) => setTokens((t) => ({ ...t, [key]: v }));
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  // A failed first load ends in an error with Try again, never the skeleton for good.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let live = true;
    getAnalyticsSettings()
      .then((s) => {
        if (!live) return;
        setSettings(s);
        setValues(toValues(s));
        setLoadError(null);
      })
      .catch((err) => {
        if (live) setLoadError(err instanceof Error ? err.message : "Failed to load analytics settings");
      });
    return () => {
      live = false;
    };
  }, [reloadKey]);

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
    for (const k of TOKEN_KEYS) {
      if (tokens[k].trim() && body[k] === undefined) body[k] = tokens[k].trim();
    }
    setSaving(true);
    try {
      const updated = await updateAnalyticsSettings(body);
      setSettings(updated);
      setValues(toValues(updated));
      setTokens(NO_TOKENS);
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
          {loadError ? (
            <Card>
              <LoadFailed
                what="analytics settings"
                onRetry={() => {
                  setLoadError(null);
                  setReloadKey((k) => k + 1);
                }}
              />
            </Card>
          ) : (
            <CardSkeleton />
          )}
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
            and only the platforms you fill in here are ever contacted. Server side purchase events (Meta,
            TikTok and Snapchat, each needing its own token below) are sent only for orders where the
            shopper accepted marketing cookies. TikTok and Snapchat server events cover online card
            payments, which the browser cannot report once the shopper returns to the confirmation page;
            pay on delivery and pickup orders are reported by the browser as before.
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
              <TokenField
                label="Conversions API access token"
                placeholder="Paste your access token"
                isSet={settings.metaCapiTokenSet}
                value={tokens.metaCapiToken}
                onChange={setToken("metaCapiToken")}
                saving={saving}
                removeMessage="Remove the saved Meta access token? Server side purchase events will stop."
                onRemove={() => void save({ metaCapiToken: null })}
              />
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">TikTok</h3>
              <p className="text-xs text-text-faint mt-1">
                The pixel code from TikTok Events Manager. Add an Events API access token as well to report
                online card payments from our server. The token is stored encrypted and is never shown again.
              </p>
            </div>
            <Input label="Pixel code" value={values.tiktokPixelId} onChange={set("tiktokPixelId")} placeholder="CXXXXXXXXXXXXXXXXXXX" error={err("tiktokPixelId")} />
            <TokenField
              label="Events API access token"
              placeholder="Paste your Events API access token"
              isSet={settings.tiktokEventsTokenSet}
              value={tokens.tiktokEventsToken}
              onChange={setToken("tiktokEventsToken")}
              saving={saving}
              removeMessage="Remove the saved TikTok access token? Server side purchase events will stop."
              onRemove={() => void save({ tiktokEventsToken: null })}
            />
          </Card>
          <Card className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Snapchat</h3>
              <p className="text-xs text-text-faint mt-1">
                The pixel id from Snap Ads Manager. Add a Conversions API token as well to report online card
                payments from our server. The token is stored encrypted and is never shown again.
              </p>
            </div>
            <Input label="Pixel id" value={values.snapPixelId} onChange={set("snapPixelId")} placeholder="1b2c3d4e-0000-4000-8000-123456789abc" error={err("snapPixelId")} />
            <TokenField
              label="Conversions API token"
              placeholder="Paste your Conversions API token"
              isSet={settings.snapCapiTokenSet}
              value={tokens.snapCapiToken}
              onChange={setToken("snapCapiToken")}
              saving={saving}
              removeMessage="Remove the saved Snapchat token? Server side purchase events will stop."
              onRemove={() => void save({ snapCapiToken: null })}
            />
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
