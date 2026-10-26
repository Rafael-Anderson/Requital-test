"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { getLoyaltyProgram, saveLoyaltyProgram } from "@/lib/api";
import type { LoyaltyProgram } from "@/lib/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Toggle from "@/components/ui/Toggle";
import PageShell from "@/components/ui/PageShell";
import { useToast } from "@/components/ui/Toast";
import SettingsContentSkeleton, { SettingsLoadFailed } from "@/components/SettingsContentSkeleton";

const BASE_LABEL: Record<LoyaltyProgram["earnBase"], string> = {
  net_paid: "Money actually paid (excludes tax, delivery, gift cards and store credit)",
  items_after_discount: "Items after discount (excludes tax and delivery only)",
};

type View = { available: false } | { available: true; currency: string | null; phoneVerificationOn: boolean; program: LoyaltyProgram };

// CUS-5 loyalty. Nothing is earned until the program is switched on here AND the
// platform has granted loyalty to the shop (otherwise this page says so). Points
// are awarded when an order is delivered and are never backdated.
export default function LoyaltySettingsPage() {
  const toast = useToast();
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [earnRate, setEarnRate] = useState("");
  const [earnBase, setEarnBase] = useState<LoyaltyProgram["earnBase"]>("net_paid");
  const [redeemEnabled, setRedeemEnabled] = useState(false);
  const [perUnit, setPerUnit] = useState("");
  const [minPts, setMinPts] = useState("1");
  const [stepPts, setStepPts] = useState("1");
  const [maxPts, setMaxPts] = useState("");
  const [saving, setSaving] = useState(false);

  function apply(v: View) {
    setView(v);
    if (!v.available) return;
    const p = v.program;
    setEnabled(p.enabled);
    setEarnRate(p.earnRate === "0" ? "" : p.earnRate);
    setEarnBase(p.earnBase);
    setRedeemEnabled(p.redeemEnabled);
    setPerUnit(p.redeemPointsPerUnit === "0" ? "" : p.redeemPointsPerUnit);
    setMinPts(String(p.redeemMinPoints));
    setStepPts(String(p.redeemStepPoints));
    setMaxPts(p.redeemMaxPoints === null ? "" : String(p.redeemMaxPoints));
  }

  useEffect(() => {
    let live = true;
    getLoyaltyProgram()
      .then((v) => {
        if (!live) return;
        setLoadError(null);
        apply(v);
      })
      .catch((err) => {
        if (live) setLoadError(err instanceof Error ? err.message : "Failed to load loyalty settings");
      });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  async function handleSave() {
    setSaving(true);
    try {
      const v = await saveLoyaltyProgram({
        enabled,
        earnRate: earnRate.trim() || "0",
        earnBase,
        redeemEnabled,
        redeemPointsPerUnit: perUnit.trim() || "0",
        redeemMinPoints: Number(minPts) || 1,
        redeemStepPoints: Number(stepPts) || 1,
        redeemMaxPoints: maxPts.trim() ? Number(maxPts) : null,
      });
      apply(v);
      toast("Loyalty settings saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save loyalty settings", "error");
    } finally {
      setSaving(false);
    }
  }

  if (view === null) {
    return loadError ? (
      <SettingsLoadFailed
        onRetry={() => {
          setLoadError(null);
          setReloadKey((k) => k + 1);
        }}
      />
    ) : (
      <SettingsContentSkeleton />
    );
  }

  if (!view.available) {
    return (
      <PageShell>
        <Card>
          <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-1">Loyalty</h3>
          <p className="text-sm text-text-muted">Loyalty points are not enabled for your shop yet. Contact Requital to turn them on.</p>
        </Card>
      </PageShell>
    );
  }

  const currency = view.currency ?? "";
  return (
    <PageShell>
      <div className="space-y-4">
        <Card>
          <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-1">Earning points</h3>
          <p className="text-xs text-text-faint mb-4">
            Customers with an account earn points when an order is delivered. Guest orders earn nothing, and
            points are taken back in proportion when an order is returned. Orders delivered before you switch
            this on never earn.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-text-secondary dark:text-zinc-400 block mb-1.5">Loyalty program</label>
              <Toggle checked={enabled} onChange={setEnabled} tooltip="Needs a points rate before it can be switched on." />
            </div>
            <Input
              label={`Points per 1 ${currency} spent`}
              inputMode="decimal"
              value={earnRate}
              onChange={(e) => setEarnRate(e.target.value)}
              placeholder="For example: 1"
            />
            <div className="sm:col-span-2 lg:col-span-3">
              <Select label="Points are earned on" value={earnBase} onChange={(e) => setEarnBase(e.target.value as LoyaltyProgram["earnBase"])}>
                {(Object.keys(BASE_LABEL) as LoyaltyProgram["earnBase"][]).map((k) => (
                  <option key={k} value={k}>
                    {BASE_LABEL[k]}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-text-faint">Points are rounded down to a whole number.</p>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-1">Redeeming points</h3>
          <p className="text-xs text-text-faint mb-4">
            Customers can turn points into store credit. This also needs phone verification on registration to be
            switched on for your shop{view.phoneVerificationOn ? " (it is)" : " (it is not, so redemption stays unavailable)"}.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-text-secondary dark:text-zinc-400 block mb-1.5">Allow redemption</label>
              <Toggle checked={redeemEnabled} onChange={setRedeemEnabled} />
            </div>
            <Input
              label={`Points that make 1 ${currency} of credit`}
              inputMode="decimal"
              value={perUnit}
              onChange={(e) => setPerUnit(e.target.value)}
              placeholder="For example: 100"
            />
            <Input label="Minimum points per redemption" inputMode="numeric" value={minPts} onChange={(e) => setMinPts(e.target.value)} />
            <Input label="Redeem in steps of (points)" inputMode="numeric" value={stepPts} onChange={(e) => setStepPts(e.target.value)} />
            <Input
              label="Maximum points per redemption"
              inputMode="numeric"
              value={maxPts}
              onChange={(e) => setMaxPts(e.target.value)}
              placeholder="No maximum"
            />
          </div>
        </Card>

        <Button variant="primary" onClick={() => void handleSave()} disabled={saving} loading={saving} className="w-fit">
          <Check className="size-4 inline -mt-0.5 me-1" />
          Save changes
        </Button>
      </div>
    </PageShell>
  );
}
