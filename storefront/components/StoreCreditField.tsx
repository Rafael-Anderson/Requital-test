"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { getMyStoreCredit } from "@/lib/api";
import { formatPriceAmount } from "@/lib/currency";
import CurrencySymbol from "@/components/CurrencySymbol";

// Checkout's store-credit opt-in (CUS-6), for a LOGGED-IN customer who has a
// balance in this shop's currency. Display only: the checkbox sends a yes/no and
// the server reads the balance itself and charges its own number. A balance in
// another currency is not shown (credit never converts), and nothing renders for
// a guest or a customer with nothing to spend.
export default function StoreCreditField({
  shopSlug,
  currency,
  checked,
  onChange,
}: {
  shopSlug: string;
  currency: string | undefined;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { customer } = useAuth();
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!customer || !currency) return;
    let live = true;
    getMyStoreCredit(shopSlug)
      .then((d) => {
        if (!live) return;
        const mine = d.balances.find((b) => b.currency === currency && b.balanceMinor > 0);
        setBalance(mine ? mine.balance : null);
      })
      .catch(() => live && setBalance(null));
    return () => {
      live = false;
    };
  }, [customer, shopSlug, currency]);

  if (!customer || !balance) return null;

  return (
    <div>
      <p className="text-sm font-medium mb-2">Store credit</p>
      <label className="flex items-start gap-3 text-sm cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 size-4 cursor-pointer"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          Use my store credit
          <span className="block text-zinc-500">
            You have {formatPriceAmount(Number(balance), currency)} <CurrencySymbol code={currency} /> available. It is
            applied to your order total, up to your balance, when you place the order.
          </span>
        </span>
      </label>
    </div>
  );
}
