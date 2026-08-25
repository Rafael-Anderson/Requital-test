"use client";

import { useEffect, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { getPlatformSettings, type PlatformSettings } from "@/lib/platform-api";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
      aria-label="Copy"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export default function PlatformSettingsPage() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);

  useEffect(() => {
    getPlatformSettings().then(setSettings);
  }, []);

  if (!settings) return <div className="text-slate-400">Loading...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-100">Platform settings</h1>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-400">
          Environment variables
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          Configured/not-configured status only — values are never returned by this API.
        </p>
        <div className="divide-y divide-slate-800">
          {settings.envVars.map((v) => (
            <div key={v.name} className="flex items-center justify-between py-2 text-sm">
              <span className="font-mono text-slate-300">{v.name}</span>
              {v.configured ? (
                <span className="flex items-center gap-1 text-emerald-400">
                  <Check className="size-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-red-400">
                  <X className="size-4" /> Not configured
                </span>
              )}
            </div>
          ))}
          <div className="flex items-center justify-between py-2 text-sm">
            <span className="font-mono text-slate-300">
              NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (admin/storefront)
            </span>
            <span className="text-slate-500">Set per-frontend, not backend-visible</span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-400">
          Webhook URLs
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          Paste these into each provider&apos;s dashboard. Never share the accompanying webhook
          secret outside this deployment&apos;s own env vars.
        </p>
        <div className="space-y-2">
          {Object.entries(settings.webhookUrls).map(([name, url]) => (
            <div
              key={name}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2"
            >
              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">{name}</div>
                <div className="font-mono text-sm text-slate-200">{url}</div>
              </div>
              <CopyButton value={url} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
