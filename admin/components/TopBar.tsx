"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getShop, storefrontUrlFor } from "@/lib/api";
import UserMenu from "./UserMenu";

// Hidden on /login and /signup by RequireAuth not rendering children there —
// this only ever mounts once a session exists.
export default function TopBar() {
  const { user } = useAuth();
  // Fetched once per session (TopBar lives in the root layout and doesn't
  // remount on navigation) — a merchant flipping the publish toggle just
  // needs a refresh to see this update, same tradeoff as elsewhere in the
  // app with no live shop-state sync.
  const [storeUrl, setStoreUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getShop()
      .then((shop) => setStoreUrl(shop.published ? storefrontUrlFor(shop) : null))
      .catch(() => setStoreUrl(null));
  }, [user]);

  if (!user) return null;

  return (
    <div className="flex items-center justify-between gap-3 px-6 py-2.5 border-b border-black/10 dark:border-white/10 text-sm">
      <Link href="/" className="flex h-6 items-center text-lg font-bold tracking-tight shrink-0">
        Requital
      </Link>
      <div className="flex items-center gap-3">
        {storeUrl && (
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            View store
            <ExternalLink className="size-3.5" />
          </a>
        )}
        <UserMenu />
      </div>
    </div>
  );
}
