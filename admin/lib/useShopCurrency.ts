"use client";

import { useEffect, useState } from "react";
import { getShop } from "./api";

// The shop's own currency, for money renders that have no owning object to read
// it from — dashboard aggregates, report rows, catalog prices, and the input
// labels that tell a merchant which unit to type in.
//
// Deliberately the same shape as lib/useShopMode.ts rather than a context: same
// getShop() source, same "one scalar off the shop row" concern, and that file's
// own comment explains why it is a per-mount fetch (a change saved in Settings
// shows up the moment a client navigation remounts the page, with no reload and
// no cross-tab sync). Adding a context here would give this app two different
// answers for the same kind of data.
//
// WHERE NOT TO USE THIS: anything rendering a stored transaction. An order,
// draft order or external delivery carries its own frozen `currency` (migration
// 20260926210000) and must be rendered with THAT, not with whatever the shop is
// set to now — otherwise a historical order silently re-denominates the moment a
// merchant changes the setting, which is precisely what freezing the column
// prevented. Read `order.currency` there.
//
// Returns null until the fetch resolves, and null on failure. formatMoney()
// treats a null currency as "render the amount with no code" rather than
// substituting a default, so the loading window degrades to "199.00" and then
// becomes "199.00 AED" — no flash of a possibly-wrong currency, and no layout
// shift beyond the code appearing.
export function useShopCurrency(): string | null {
  const [currency, setCurrency] = useState<string | null>(null);

  useEffect(() => {
    getShop()
      .then((s) => setCurrency(s.currency))
      // Silent: a money amount with no currency code is a smaller problem than
      // an error toast on every page, and asserting a default would be a lie.
      .catch(() => setCurrency(null));
  }, []);

  return currency;
}
