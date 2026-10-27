"use client";

import { useEffect, useState } from "react";
import { adjustCustomerLoyalty, getCustomerLoyalty } from "@/lib/api";
import type { CustomerLoyaltyOverview, LoyaltyEntry } from "@/lib/types";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import LoadFailed from "@/components/ui/LoadFailed";
import Skeleton from "@/components/ui/Skeleton";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import { useToast } from "@/components/ui/Toast";

const TYPE_LABEL: Record<LoyaltyEntry["type"], string> = {
  earn: "Earned on an order",
  clawback: "Taken back (return)",
  adjust: "Adjusted by staff",
  redeem: "Redeemed for store credit",
};

// A fresh key per form session so a double click is applied once; renewed after success.
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);

// CUS-5. The points balance and ledger; admins can add or remove points with a
// reason. Renders nothing at all when the platform has not granted loyalty.
export default function LoyaltyCard({ customerId, canEdit }: { customerId: number; canEdit: boolean }) {
  const toast = useToast();
  const [data, setData] = useState<CustomerLoyaltyOverview | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getCustomerLoyalty(customerId)
      .then((d) => live && setData(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [customerId, tick]);

  if (data && !data.available) return null;

  const amount = Number(points);
  const validPoints = Number.isInteger(amount) && amount !== 0;

  async function submit() {
    setBusy(true);
    setFormError(null);
    try {
      setData(await adjustCustomerLoyalty(customerId, { points: amount, reason: reason.trim(), idempotencyKey: key }));
      setPoints("");
      setReason("");
      setKey(newKey());
      toast("Points updated");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save the change");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 font-medium">Loyalty points</h2>
      <p className="mb-3 text-xs text-text-faint">
        Earned when an order is delivered. The balance cannot go below zero.
      </p>
      {error && data === null ? (
        <LoadFailed
          what="loyalty points"
          onRetry={() => {
            setError(false);
            setTick((t) => t + 1);
          }}
        />
      ) : data === null || !data.available ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="space-y-4">
          <div>
            <div className="text-xl font-semibold">{data.balance.toLocaleString()}</div>
            <div className="text-xs text-text-faint">
              points{data.programEnabled ? "" : " (the program is switched off, so none are shown to the customer)"}
            </div>
          </div>

          {data.shortfallTotal > 0 && (
            <p className="rounded-xl border border-amber-300 p-3 text-xs text-text-secondary">
              {data.shortfallTotal.toLocaleString()} points could not be taken back on returned orders because the
              customer had already spent them. They are only recorded here; nothing was recovered.
            </p>
          )}

          {canEdit && (
            <div className="space-y-3 rounded-xl border border-border p-3 dark:border-white/10">
              {formError && <InlineErrorMessage>{formError}</InlineErrorMessage>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Points (use a minus sign to remove)"
                  inputMode="numeric"
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                />
                <Input
                  label="Reason (required)"
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="For example: goodwill for a late delivery"
                />
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={() => void submit()} loading={busy} disabled={busy || !validPoints || reason.trim().length < 3}>
                  Update points
                </Button>
              </div>
            </div>
          )}

          {data.entries.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-text-secondary">Ledger ({data.entries.length})</summary>
              <ul className="mt-2 space-y-2">
                {data.entries.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                    <span className="min-w-0">
                      <span className="font-medium text-text-secondary">{TYPE_LABEL[e.type]}</span>
                      {e.orderNumber ? ` · order #${e.orderNumber}` : ""}
                      {e.reason ? ` · ${e.reason}` : ""}
                      {e.actorName ? ` · ${e.actorName}` : ""}
                      {e.shortfall > 0 ? ` · ${e.shortfall} points could not be taken back (already spent)` : ""}
                      <span className="text-text-faint"> · {new Date(e.createdAt).toLocaleString()}</span>
                    </span>
                    <span className={e.points < 0 ? "text-red-600" : "text-green-700"}>
                      {e.points > 0 ? "+" : ""}
                      {e.points}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
