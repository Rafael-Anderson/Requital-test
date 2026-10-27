"use client";

import { useEffect, useState } from "react";
import { useShop } from "@/lib/shop-context";
import { getMyLoyalty } from "@/lib/api";
import type { MyLoyalty } from "@/lib/types";

const LABEL = {
  earn: "Earned on an order",
  clawback: "Taken back (return)",
  adjust: "Adjustment",
  redeem: "Redeemed for store credit",
} as const;

// The customer's own loyalty points (CUS-5), read only. Renders nothing while it
// loads, on any failure, and whenever the shop has loyalty off, so a shop that
// does not use it shows no trace of it.
export default function LoyaltyCard() {
  const { shopSlug } = useShop();
  const [data, setData] = useState<MyLoyalty | null>(null);

  useEffect(() => {
    let live = true;
    getMyLoyalty(shopSlug)
      .then((d) => live && setData(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [shopSlug]);

  if (!data || !data.enabled) return null;

  return (
    <div className="rounded-lg border border-black/10 p-4 space-y-3">
      <div>
        <p className="font-medium">Loyalty points</p>
        <p className="text-2xl font-semibold">{data.balance.toLocaleString()}</p>
      </div>
      {data.entries.length > 0 && (
        <ul className="space-y-1 text-sm">
          {data.entries.slice(0, 5).map((e) => (
            <li key={e.id} className="flex justify-between gap-3">
              <span className="min-w-0 text-zinc-600">
                {LABEL[e.type]}
                {e.orderNumber ? ` (order #${e.orderNumber})` : ""}
              </span>
              <span className={e.points < 0 ? "text-red-600" : "text-green-700"}>
                {e.points > 0 ? "+" : ""}
                {e.points}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
