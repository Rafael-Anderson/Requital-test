"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Package, ClipboardList, Users, Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { globalSearch, type GlobalSearchResult } from "@/lib/api";

const SEARCH_DEBOUNCE_MS = 300;

interface FlatResult {
  key: string;
  type: "product" | "order" | "customer";
  label: string;
  sublabel: string;
  href: string;
}

function flatten(result: GlobalSearchResult | null): FlatResult[] {
  if (!result) return [];
  return [
    ...result.products.map((p) => ({
      key: `product-${p.id}`,
      type: "product" as const,
      label: p.name,
      sublabel: `${p.sku} · ${p.price} AED`,
      href: `/inventory/${p.id}/edit`,
    })),
    ...result.orders.map((o) => ({
      key: `order-${o.id}`,
      type: "order" as const,
      label: `Order #${o.id} — ${o.customerName}`,
      sublabel: `${o.status.replace(/_/g, " ")} · ${o.total} AED`,
      href: `/orders/${o.id}`,
    })),
    ...result.customers.map((c) => ({
      key: `customer-${c.id}`,
      type: "customer" as const,
      label: c.name,
      sublabel: c.phone,
      href: `/customers/${c.id}`,
    })),
  ];
}

const TYPE_LABEL: Record<FlatResult["type"], string> = {
  product: "Product",
  order: "Order",
  customer: "Customer",
};
const TYPE_ICON: Record<FlatResult["type"], typeof Package> = {
  product: Package,
  order: ClipboardList,
  customer: Users,
};

// Mounted once, globally, inside the authenticated shell — self-gates on
// auth state (no point registering the shortcut or hitting /search before
// there's a session). No prior Cmd+K/command-palette infrastructure existed
// anywhere in this app to build on.
export default function CommandPalette() {
  const { user } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const flat = useMemo(() => flatten(result), [result]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResult(null);
    setActiveIndex(0);
  }, []);

  // Global shortcut — Cmd+K on Mac, Ctrl+K elsewhere, works even while
  // focus is inside a normal text input (standard command-palette behavior).
  useEffect(() => {
    if (!user) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        close();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [user, close]);

  useEffect(() => {
    if (!open || !query.trim()) {
      setResult(null);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      globalSearch(query.trim())
        .then((r) => {
          setResult(r);
          setActiveIndex(0);
        })
        .catch(() => setResult(null))
        .finally(() => setLoading(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, open]);

  function navigateTo(item: FlatResult) {
    router.push(item.href);
    close();
  }

  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[activeIndex]) navigateTo(flat[activeIndex]);
    }
  }

  if (!user || !open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-24 px-4" onClick={close}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg bg-white dark:bg-zinc-900 border dark:border-white/10 shadow-xl overflow-hidden"
      >
        <div className="flex items-center gap-2 border-b dark:border-white/10 px-4 py-3">
          <Search className="size-4 text-zinc-400 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search products, orders, customers…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
          />
          <kbd className="text-xs text-zinc-400 border rounded px-1.5 py-0.5 dark:border-white/15 shrink-0">Esc</kbd>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {loading ? (
            <p className="px-4 py-6 text-sm text-zinc-400 text-center">Searching…</p>
          ) : !query.trim() ? (
            <p className="px-4 py-6 text-sm text-zinc-400 text-center">
              Type to search products, orders, and customers.
            </p>
          ) : flat.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-400 text-center">No results for &quot;{query}&quot;.</p>
          ) : (
            <div className="py-1.5">
              {flat.map((item, i) => {
                const Icon = TYPE_ICON[item.type];
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => navigateTo(item)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm cursor-pointer transition-colors ${
                      i === activeIndex ? "bg-black/5 dark:bg-white/10" : "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                    }`}
                  >
                    <Icon className="size-4 text-zinc-400 shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-medium">{item.label}</span>
                      <span className="block truncate text-xs text-zinc-500">{item.sublabel}</span>
                    </span>
                    <span className="text-xs text-zinc-400 shrink-0">{TYPE_LABEL[item.type]}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
