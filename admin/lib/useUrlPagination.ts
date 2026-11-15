"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/components/ui/Pagination";

// Page, page size and "show all" live in the URL (?page=3&pageSize=50&all=1), so a
// refresh and the Back button restore exactly what was on screen. Any other query
// parameter is preserved. Changing the page size or entering show-all resets the
// page; `resetPage()` is for a filter change.
//
// Reading is forgiving (junk falls back to page 1 / 20) and writing is canonical
// (defaults are removed from the URL), so a clean URL stays clean.

export function parsePositiveInt(value: string | null, fallback: number): number {
  if (value === null || !/^\d{1,7}$/.test(value)) return fallback;
  const n = Number(value);
  return n >= 1 ? n : fallback;
}

export function parsePageSize(value: string | null): number {
  const n = parsePositiveInt(value, DEFAULT_PAGE_SIZE);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

export function useUrlPagination() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const page = parsePositiveInt(searchParams.get("page"), 1);
  const pageSize = parsePageSize(searchParams.get("pageSize"));
  const all = searchParams.get("all") === "1";

  // Rewrites the query string: `changes` values of null/"" delete the key.
  const update = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return useMemo(
    () => ({
      page,
      pageSize,
      all,
      params: searchParams,
      update,
      setPage: (p: number) => update({ page: p <= 1 ? null : String(p), all: null }),
      setPageSize: (n: number) =>
        update({ pageSize: n === DEFAULT_PAGE_SIZE ? null : String(n), page: null, all: null }),
      setAll: (on: boolean) => update({ all: on ? "1" : null, page: null }),
      // A filter changed: back to page 1 (and out of show-all).
      resetPage: (changes: Record<string, string | null> = {}) => update({ ...changes, page: null, all: null }),
    }),
    [page, pageSize, all, searchParams, update],
  );
}
