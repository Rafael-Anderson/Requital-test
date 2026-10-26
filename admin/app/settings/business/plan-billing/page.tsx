"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Minus } from "lucide-react";
import { getBillingSubscription, getBillingUsage } from "@/lib/api";
import type { BillingSubscription, BillingUsage } from "@/lib/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import PageShell from "@/components/ui/PageShell";
import SettingsContentSkeleton, { SettingsLoadFailed } from "@/components/SettingsContentSkeleton";

// PLT-1 first slice: read only. There is no price book, no Stripe and no way to
// change plan yet, so the Change plan button is disabled and says so. The two
// requests are independent chains, so a failed usage count never hides the plan.

const STATUS_LABEL: Record<NonNullable<BillingSubscription["status"]>, string> = {
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment overdue",
  suspended: "Suspended",
  cancelled: "Cancelled",
};

const SOURCE_LABEL: Record<NonNullable<BillingSubscription["source"]>, string> = {
  legacy: "Free, kept from before plans existed",
  stripe: "Paid subscription",
  comp: "Complimentary",
};

function monthLabel(periodKey: string): string {
  const d = new Date(`${periodKey}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return periodKey;
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

function dateLabel(iso: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(iso));
}

function usageMessage(u: BillingUsage): string {
  if (u.ceiling == null) return "Your plan has no monthly order limit.";
  if (u.level >= 100) return "You have reached your plan's order volume. Orders keep coming in; nothing is blocked.";
  if (u.level >= 80) return "You have used most of this month's orders on your plan. Nothing is blocked.";
  return "Orders are never blocked, even above the plan's volume.";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-text-faint mb-1">{label}</p>
      <div className="text-sm text-text-primary dark:text-zinc-100">{children}</div>
    </div>
  );
}

export default function PlanBillingPage() {
  const [sub, setSub] = useState<BillingSubscription | null>(null);
  const [subError, setSubError] = useState<string | null>(null);
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

  // Each chain drops a response a newer call has superseded.
  const latestSub = useRef(0);
  const loadSub = useCallback(() => {
    const mine = ++latestSub.current;
    getBillingSubscription()
      .then((s) => {
        if (mine !== latestSub.current) return;
        setSub(s);
        setSubError(null);
      })
      .catch((e) => {
        if (mine !== latestSub.current) return;
        setSubError(e instanceof Error ? e.message : "Failed to load your plan");
      });
  }, []);
  const latestUsage = useRef(0);
  const loadUsage = useCallback(() => {
    const mine = ++latestUsage.current;
    getBillingUsage()
      .then((u) => {
        if (mine !== latestUsage.current) return;
        setUsage(u);
        setUsageError(null);
      })
      .catch((e) => {
        if (mine !== latestUsage.current) return;
        setUsageError(e instanceof Error ? e.message : "Failed to load your order usage");
      });
  }, []);

  useEffect(() => {
    loadSub();
    loadUsage();
  }, [loadSub, loadUsage]);

  return (
    <PageShell variant="form">
      <h1 className="text-2xl font-semibold mb-4">Plan &amp; Billing</h1>

      <div className="space-y-6">
        {sub ? (
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-text-primary dark:text-zinc-50">Current plan</h2>
                <p className="mt-1 text-sm text-text-secondary dark:text-zinc-400">
                  {sub.plan ? sub.plan.name : "No plan is recorded for this shop"}
                </p>
              </div>
              <div className="flex flex-col items-start gap-1 sm:items-end">
                <Button variant="secondary" disabled>
                  Change plan
                </Button>
                <p className="text-xs text-text-faint">Plan changes are not available yet.</p>
              </div>
            </div>
            {sub.hasSubscription ? (
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sub.status && <Row label="Status">{STATUS_LABEL[sub.status]}</Row>}
                {sub.source && <Row label="Type">{SOURCE_LABEL[sub.source]}</Row>}
                {sub.trialEndsAt && <Row label="Trial ends">{dateLabel(sub.trialEndsAt)}</Row>}
                {sub.currentPeriodEnd && (
                  <Row label={sub.cancelAtPeriodEnd ? "Ends on" : "Renews on"}>{dateLabel(sub.currentPeriodEnd)}</Row>
                )}
              </div>
            ) : (
              <p className="mt-4 text-sm text-text-secondary dark:text-zinc-400">
                Every feature is available to your shop.
              </p>
            )}
          </Card>
        ) : subError ? (
          <SettingsLoadFailed what="your plan" onRetry={() => { setSubError(null); loadSub(); }} />
        ) : (
          <SettingsContentSkeleton cards={1} />
        )}

        {usage ? (
          <Card>
            <h2 className="text-lg font-bold text-text-primary dark:text-zinc-50">Orders this month</h2>
            <p className="mt-1 text-sm text-text-secondary dark:text-zinc-400">{monthLabel(usage.periodKey)}</p>
            <p className="mt-4 text-2xl font-semibold text-text-primary dark:text-zinc-50">
              {usage.used}
              {usage.ceiling != null && (
                <span className="text-base font-normal text-text-secondary dark:text-zinc-400">
                  {" "}
                  of {usage.ceiling} ({usage.percent ?? 0}%)
                </span>
              )}
            </p>
            {usage.ceiling != null && (
              <div
                role="progressbar"
                aria-label="Orders used this month"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(usage.percent ?? 0, 100)}
                className="mt-3 h-2 w-full overflow-hidden rounded-full bg-neutral-chip-bg dark:bg-zinc-800"
              >
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.min(usage.percent ?? 0, 100)}%` }}
                />
              </div>
            )}
            <p className="mt-3 text-sm text-text-secondary dark:text-zinc-400">{usageMessage(usage)}</p>
            <p className="mt-1 text-xs text-text-faint">Cancelled orders are not counted.</p>
          </Card>
        ) : usageError ? (
          <SettingsLoadFailed what="your order usage" onRetry={() => { setUsageError(null); loadUsage(); }} />
        ) : (
          <SettingsContentSkeleton cards={1} />
        )}

        {sub && (
          <Card>
            <h2 className="text-lg font-bold text-text-primary dark:text-zinc-50">What your plan includes</h2>
            <ul className="mt-4 divide-y divide-border dark:divide-white/10">
              {sub.features.map((f) => (
                <li key={f.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 text-text-primary dark:text-zinc-100">{f.description}</span>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold ${
                      f.entitled ? "text-accent-text dark:text-accent" : "text-text-faint"
                    }`}
                  >
                    {f.entitled ? <Check className="size-3.5" aria-hidden /> : <Minus className="size-3.5" aria-hidden />}
                    {f.entitled ? "Included" : "Not included"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
