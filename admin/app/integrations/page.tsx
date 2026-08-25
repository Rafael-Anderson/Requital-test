"use client";

import { useEffect, useState } from "react";
import { Bike, Truck } from "lucide-react";
import { getSliderSettings, setSliderEnabled } from "@/lib/api";
import type { SliderSettings } from "@/lib/types";
import Card from "@/components/ui/Card";
import Toggle from "@/components/ui/Toggle";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";

const STATUS_STYLES: Record<SliderSettings["status"], string> = {
  connected: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
  awaiting_setup: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  not_enabled: "bg-neutral-chip-bg text-neutral-chip-text dark:bg-zinc-800 dark:text-zinc-400",
};
const STATUS_LABELS: Record<SliderSettings["status"], string> = {
  connected: "Connected",
  awaiting_setup: "Awaiting setup",
  not_enabled: "Not enabled",
};

export default function DeliveryIntegrationsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<SliderSettings | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setSettings(await getSliderSettings());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleToggle(next: boolean) {
    setSaving(true);
    try {
      setSettings(await setSliderEnabled(next));
      toast(next ? "Slider delivery enabled" : "Slider delivery disabled");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update Slider delivery", "error");
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
        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-accent-tint text-accent dark:bg-accent/15 shrink-0">
                <Truck className="size-[18px]" strokeWidth={1.8} />
              </span>
              <div>
                <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">Slider</h3>
                <p className="text-xs text-text-faint mt-1 max-w-md">
                  On-demand rider network for delivery dispatch, straight from an order&apos;s detail view.
                  Live driver tracking and cash-on-delivery collection are both supported.
                </p>
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold whitespace-nowrap ${STATUS_STYLES[settings.status]}`}
            >
              {STATUS_LABELS[settings.status]}
            </span>
          </div>

          {settings.status === "awaiting_setup" && (
            <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 rounded-lg px-3 py-2">
              Your Slider account is being set up. Delivery dispatch will be available once complete.
            </p>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="text-sm font-medium text-text-secondary dark:text-zinc-300">
              Enable Slider delivery
            </span>
            <Toggle checked={settings.enabled} onChange={handleToggle} disabled={saving} />
          </div>
        </Card>

        <Card className="space-y-3 opacity-60">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-neutral-chip-bg text-neutral-chip-text dark:bg-zinc-800 dark:text-zinc-400 shrink-0">
              <Bike className="size-[18px]" strokeWidth={1.8} />
            </span>
            <div className="flex-1">
              <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">Lalamove</h3>
              <p className="text-xs text-text-faint mt-1">On-demand delivery dispatch.</p>
            </div>
            <span className="rounded-full bg-neutral-chip-bg px-2.5 py-1 text-[11.5px] font-bold text-neutral-chip-text dark:bg-zinc-800 dark:text-zinc-400 whitespace-nowrap">
              Coming soon
            </span>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
