"use client";

import { useEffect, useState } from "react";
import { adjustCustomerStoreCredit, getCustomerStoreCredit } from "@/lib/api";
import type { StoreCreditEntry, StoreCreditOverview } from "@/lib/types";
import { useShopCurrency } from "@/lib/useShopCurrency";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import LoadFailed from "@/components/ui/LoadFailed";
import Skeleton from "@/components/ui/Skeleton";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import { useToast } from "@/components/ui/Toast";

const CURRENCIES = ["AED", "SAR", "KWD", "QAR", "BHD", "OMR", "USD"];

const TYPE_LABEL: Record<StoreCreditEntry["type"], string> = {
  grant: "Added by staff",
  deduct: "Taken off by staff",
  spend: "Spent on an order",
  spend_reversal: "Returned (order cancelled)",
  return_refund: "Refunded from a return",
};

// A fresh key per form session, so a double click or a retry of one submit is
// applied once by the server; the key is renewed after each success.
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);

// CUS-6. The balance per currency, the full ledger, and (for admins) grant and
// deduct. Credit is spent only in the currency it was issued in, so balances are
// listed per currency and never added together.
export default function StoreCreditCard({ customerId, canEdit }: { customerId: number; canEdit: boolean }) {
  const toast = useToast();
  const shopCurrency = useShopCurrency();
  const [data, setData] = useState<StoreCreditOverview | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const [direction, setDirection] = useState<"grant" | "deduct">("grant");
  const [currency, setCurrency] = useState<string>(shopCurrency || "AED");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getCustomerStoreCredit(customerId)
      .then((d) => live && setData(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [customerId, tick]);

  async function submit() {
    setBusy(true);
    setFormError(null);
    try {
      setData(
        await adjustCustomerStoreCredit(customerId, {
          currency,
          amount: amount.trim(),
          direction,
          reason: reason.trim(),
          idempotencyKey: key,
        }),
      );
      setAmount("");
      setReason("");
      setKey(newKey());
      toast(direction === "grant" ? "Store credit added" : "Store credit deducted");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save the change");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 font-medium">Store credit</h2>
      <p className="mb-3 text-xs text-text-faint">
        Spent at checkout by the customer when logged in, in the currency it was issued in. It cannot go below zero.
      </p>
      {error && data === null ? (
        <LoadFailed
          what="store credit"
          onRetry={() => {
            setError(false);
            setTick((t) => t + 1);
          }}
        />
      ) : data === null ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            {data.balances.length === 0 && <p className="text-sm text-text-faint">No store credit.</p>}
            {data.balances.map((b) => (
              <div key={b.currency}>
                <div className="text-xl font-semibold">
                  {b.balance} <span className="text-sm font-normal text-text-muted">{b.currency}</span>
                </div>
                <div className="text-xs text-text-faint">balance</div>
              </div>
            ))}
          </div>

          {canEdit && (
            <div className="space-y-3 rounded-xl border border-border p-3 dark:border-white/10">
              {formError && <InlineErrorMessage>{formError}</InlineErrorMessage>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Select label="Action" value={direction} onChange={(e) => setDirection(e.target.value as "grant" | "deduct")}>
                  <option value="grant">Add credit</option>
                  <option value="deduct">Deduct credit</option>
                </Select>
                <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <Input label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <Input
                label="Reason (required)"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder="For example: goodwill for a late delivery"
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={() => void submit()} loading={busy} disabled={busy || !amount.trim() || reason.trim().length < 3}>
                  {direction === "grant" ? "Add credit" : "Deduct credit"}
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
                      {e.orderId ? ` · order ${e.orderId}` : ""}
                      {e.reason ? ` · ${e.reason}` : ""}
                      {e.actorName ? ` · ${e.actorName}` : ""}
                      <span className="text-text-faint"> · {new Date(e.createdAt).toLocaleString()}</span>
                    </span>
                    <span className={Number(e.amount) < 0 ? "text-red-600" : "text-green-700"}>
                      {Number(e.amount) > 0 ? "+" : ""}
                      {e.amount} {e.currency}
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
