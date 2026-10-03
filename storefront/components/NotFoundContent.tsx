"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { reportNotFound } from "@/lib/api";
import StorefrontPageShell from "./StorefrontPageShell";

// Strips the /<shop> prefix when this request arrived by path (local/CI), so
// the logged path is always the one a visitor and a merchant would recognise.
export function loggedPath(pathname: string, shopBasePath: string): string {
  if (shopBasePath && (pathname === shopBasePath || pathname.startsWith(`${shopBasePath}/`))) {
    return pathname.slice(shopBasePath.length) || "/";
  }
  return pathname;
}

// The storefront's page-not-found state. Reports the missing URL to the
// merchant's 404 log (ONB-4) at most once per path per tab, and never from the
// theme builder's preview iframe.
export default function NotFoundContent() {
  const { shopSlug, shopBasePath, previewMode } = useShop();

  useEffect(() => {
    if (previewMode) return;
    const path = loggedPath(window.location.pathname, shopBasePath);
    const key = `requital_404_reported:${shopSlug}:${path}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Storage blocked: report anyway; the server de-duplicates by counting.
    }
    reportNotFound(shopSlug, path, document.referrer);
  }, [shopSlug, shopBasePath, previewMode]);

  return (
    <StorefrontPageShell variant="narrow">
      <div className="py-16 text-center">
        <h1 className="text-2xl font-semibold text-product-name">Page not found</h1>
        <p className="mt-2 text-sm text-zinc-500">
          The page you are looking for does not exist or may have moved.
        </p>
        <Link
          href={shopBasePath || "/"}
          className="mt-6 inline-block rounded-md bg-accent px-5 py-2 text-sm font-medium text-accent-foreground"
        >
          Back to the shop
        </Link>
      </div>
    </StorefrontPageShell>
  );
}
