"use client";

import { useShop } from "@/lib/shop-context";

// "Grid First" homepage layout — deliberately skips the tall banner/tinted
// hero block entirely (unlike Classic's fallback, which still renders one)
// so products start immediately below the header. A merchant who's set
// heroText still sees it, just as a slim caption line rather than a full
// hero section — this preset is for shops that would rather not spend the
// fold on branding at all.
export default function GridFirstHero({ heroText }: { heroText: string | null }) {
  const { shop } = useShop();
  if (!shop) return null;
  return (
    <div className="mb-5 flex items-baseline justify-between gap-4 flex-wrap">
      <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{shop.displayName ?? shop.name}</h1>
      {heroText && <p className="text-sm text-zinc-500">{heroText}</p>}
    </div>
  );
}
