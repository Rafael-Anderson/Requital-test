"use client";

import { useCallback, useEffect, useState } from "react";
import { createGiftCard, listGiftCards, updateGiftCard } from "@/lib/api";
import type { GiftCard } from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import EmptyState from "@/components/ui/EmptyState";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import ProductsTabs from "@/components/ProductsTabs";
import PageShell from "@/components/ui/PageShell";

const STATUS_STYLE: Record<GiftCard["status"], string> = {
  active: "border-green-400 text-green-700 dark:text-green-400",
  redeemed: "border-zinc-300 text-text-muted dark:border-zinc-700",
  expired: "border-amber-400 text-amber-700 dark:text-amber-400",
  disabled: "border-red-300 text-red-600 dark:border-red-800 dark:text-red-400",
};

export default function GiftCardsPage() {
  const toast = useToast();
  const [cards, setCards] = useState<GiftCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [issuing, setIssuing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setCards(await listGiftCards());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load gift cards");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleIssue() {
    const value = Number(amount);
    if (!value || value <= 0) {
      toast("Enter an amount greater than zero", "error");
      return;
    }
    setIssuing(true);
    try {
      const card = await createGiftCard({ initialValue: value, expiresAt: expiresAt || undefined });
      toast(`Issued gift card ${card.code}`);
      setAmount("");
      setExpiresAt("");
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to issue gift card", "error");
    } finally {
      setIssuing(false);
    }
  }

  async function toggleDisabled(card: GiftCard) {
    try {
      const updated = await updateGiftCard(card.id, { status: card.status === "disabled" ? "active" : "disabled" });
      setCards((prev) => (prev ? prev.map((c) => (c.id === card.id ? updated : c)) : prev));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update gift card", "error");
    }
  }

  return (
    <PageShell>
      <BackButton href="/products" />
      <ProductsTabs />
      <h1 className="text-2xl font-semibold mb-1">Gift Cards</h1>
      <p className="text-sm text-text-muted mb-4">
        Cards purchased on your storefront show up automatically. Issue one by hand below for service credit or a
        promotion.
      </p>

      <Card className="mb-4">
        <h3 className="text-sm font-semibold mb-3">Issue a gift card</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-32">
            <Input label="Amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="w-44">
            <Input label="Expires (optional)" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
          <Button variant="primary" onClick={handleIssue} disabled={issuing}>
            {issuing ? "Issuing…" : "Issue card"}
          </Button>
        </div>
      </Card>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <Table>
        <THead>
          <tr>
            <TH>Code</TH>
            <TH className="w-24">Balance</TH>
            <TH className="w-24">Value</TH>
            <TH className="w-24">Status</TH>
            <TH>Purchased by</TH>
            <TH className="w-24"></TH>
          </tr>
        </THead>
        <TBody>
          {cards === null ? (
            <tr>
              <td colSpan={6}>
                <TableSkeleton rows={3} cols={6} />
              </td>
            </tr>
          ) : cards.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <EmptyState title="No gift cards yet" description="Issue one above, or sell a gift card product on your storefront." />
              </td>
            </tr>
          ) : (
            cards.map((c) => (
              <TR key={c.id}>
                <TD className="font-mono text-xs">{c.code}</TD>
                <TD className="text-text-muted">{c.remainingBalance}</TD>
                <TD className="text-text-muted">{c.initialValue}</TD>
                <TD>
                  <span className={`text-xs rounded px-2 py-1 border capitalize ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                </TD>
                <TD className="text-text-muted">{c.purchasedByCustomer?.name ?? "-"}</TD>
                <TD>
                  {(c.status === "active" || c.status === "disabled") && (
                    <button
                      onClick={() => toggleDisabled(c)}
                      className="text-xs text-text-muted hover:text-accent-text dark:hover:text-accent cursor-pointer"
                    >
                      {c.status === "disabled" ? "Enable" : "Disable"}
                    </button>
                  )}
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </PageShell>
  );
}
