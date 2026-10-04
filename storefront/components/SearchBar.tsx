"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { resolveImageUrl, searchProducts } from "@/lib/api";
import { track } from "@/lib/analytics";
import { iconStyleProps } from "@/lib/icon-style";
import { OPEN_SEARCH_EVENT } from "@/lib/mobile-nav";
import type { IconCornerProps } from "@/lib/theme-element-style";
import CurrencySymbol from "@/components/CurrencySymbol";
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
  iconCorners,
  iconOverrideStyle,
  showLabel,
}: {
  iconStrokeWidth?: number;
  // §8.7 item 4 — icons.corners, passed down from ThemeDrivenHeader the same
  // way iconStrokeWidth is; absent ⇒ lucide's own round/round default.
  iconCorners?: IconCornerProps;
  iconOverrideStyle?: CSSProperties;
  // C1 — header.blocks[].settings.showLabel on search_icon (default/absent
  // false, today's icon-only trigger unchanged).
  showLabel?: boolean;
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
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // The bottom-bar mobile nav's "Search" tab asks the header search to open (and brings it into
  // view: the header scrolls away with the page).
  useEffect(() => {
    function onOpenRequest() {
      rootRef.current?.scrollIntoView({ block: "nearest" });
      setOpen(true);
    }
    window.addEventListener(OPEN_SEARCH_EVENT, onOpenRequest);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, onOpenRequest);
  }, []);

  // Escape closes the dropdown and hands focus back to the search button.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
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
          // Debounced already (one request per pause in typing), so this is one
          // `search` event per settled query. No-op without cookie consent.
          track("search", { query: trimmed });
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

  const iconProps = { ...iconStyleProps(shop?.iconStyle, iconStrokeWidth ?? 1.75), ...iconCorners };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Search"
        aria-expanded={open}
        className={`flex items-center justify-center hover:bg-mouse-over/10 transition-colors cursor-pointer ${showLabel ? "gap-1.5 h-9 px-3 rounded-full" : "size-9 rounded-full"}`}
      >
        <Search className="size-5" {...iconProps} style={iconOverrideStyle} />
        {showLabel && <span className="text-sm">Search</span>}
      </button>

      {/* Under sm the panel is pinned 12px from both viewport edges (fixed with its top left at the
            static position, i.e. just under the button). Right-aligned to the button with a fixed
            w-72 it ran off the LEFT edge on a 360px phone whenever the button sat in the middle of
            the header. */}
      {open && (
        <div className="absolute end-0 mt-2 w-72 max-sm:fixed max-sm:inset-x-3 max-sm:w-auto sm:w-80 rounded-lg border border-popover-border bg-popover text-popover-fg shadow-[0_8px_24px_rgba(0,0,0,0.12)] z-50 overflow-hidden">
          <div className="p-2 border-b border-popover-border">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products…"
              className="w-full h-9 rounded-md border border-popover-border bg-background px-3 text-sm outline-none focus:border-accent transition-colors"
            />
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading && <p className="p-3 text-sm text-popover-fg/60">Searching…</p>}

            {!loading && searched && suggestion && (
              <p className="px-3 pt-2.5 text-xs text-popover-fg/60">
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
              <p className="p-3 text-sm text-popover-fg/60">No products found.</p>
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
                    <p className="text-sm truncate" title={r.name}>{r.name}</p>
                    <p className="text-xs text-popover-fg/60">
                      {r.price} <CurrencySymbol code={shop?.currency} />
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
