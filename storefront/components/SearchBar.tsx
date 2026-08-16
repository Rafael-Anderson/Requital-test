"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { resolveImageUrl, searchProducts } from "@/lib/api";
import { iconStyleProps } from "@/lib/icon-style";
import type { SearchResultItem } from "@/lib/types";

const DEBOUNCE_MS = 300;

// Header search — icon toggles a dropdown with a debounced product search
// (typo-tolerant, see backend StorefrontSearchService) rather than a
// separate results page, matching the header's existing icon-triggered
// affordances (cart drawer, mobile menu). iconStrokeWidth/iconOverrideStyle
// are optional so this component's other real caller (none currently, but
// kept generic) doesn't need to know about the theme builder's global
// icon-stroke setting or an in-preview per-element color/size override —
// ThemeDrivenHeader.tsx is the only caller passing them today.
export default function SearchBar({
  iconStrokeWidth,
  iconOverrideStyle,
}: {
  iconStrokeWidth?: number;
  iconOverrideStyle?: CSSProperties;
} = {}) {
  const { shopSlug, shopBasePath, shop } = useShop();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSuggestion(null);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      searchProducts(shopSlug, trimmed)
        .then((res) => {
          setResults(res.results);
          setSuggestion(res.suggestion);
        })
        .catch(() => {
          setResults([]);
          setSuggestion(null);
        })
        .finally(() => {
          setLoading(false);
          setSearched(true);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, shopSlug]);

  const iconProps = iconStyleProps(shop?.iconStyle, iconStrokeWidth ?? 1.75);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Search"
        className="flex items-center justify-center size-9 rounded-full hover:bg-mouse-over/10 transition-colors cursor-pointer"
      >
        <Search className="size-5" {...iconProps} style={iconOverrideStyle} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 sm:w-80 rounded-lg border border-stroke bg-header text-header-fg shadow-[0_8px_24px_rgba(0,0,0,0.12)] z-50 overflow-hidden">
          <div className="p-2 border-b border-stroke">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products…"
              className="w-full h-9 rounded-md border border-stroke bg-white dark:bg-zinc-900 px-3 text-sm outline-none focus:border-accent transition-colors"
            />
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading && <p className="p-3 text-sm text-zinc-500">Searching…</p>}

            {!loading && searched && suggestion && (
              <p className="px-3 pt-2.5 text-xs text-zinc-500">
                Did you mean{" "}
                <button
                  type="button"
                  className="underline text-accent-text hover:no-underline"
                  onClick={() => setQuery(suggestion)}
                >
                  {suggestion}
                </button>
                ?
              </p>
            )}

            {!loading && searched && results.length === 0 && (
              <p className="p-3 text-sm text-zinc-500">No products found.</p>
            )}

            {!loading &&
              results.map((r) => (
                <Link
                  key={r.id}
                  href={`${shopBasePath}/products/${r.slug}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 p-2.5 hover:bg-mouse-over/10 transition-colors"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resolveImageUrl(r.thumbnail) ?? undefined}
                    alt=""
                    className="size-10 rounded object-cover shrink-0 bg-black/5"
                  />
                  <div className="min-w-0">
                    <p className="text-sm truncate">{r.name}</p>
                    <p className="text-xs text-zinc-500">
                      {r.price} {shop?.currency}
                    </p>
                  </div>
                </Link>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
