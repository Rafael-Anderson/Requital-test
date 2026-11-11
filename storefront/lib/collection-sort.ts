// Which order a collection page opens in. An explicit ?sort= in the URL always wins; otherwise the
// collection's own default (set by the merchant, NULL = none); otherwise Newest, the page's
// long-standing default. Anything that is not one of the page's own sort keys is ignored, so a
// stale or hand-edited link can never produce an unknown sort. The keys mirror the page's
// SORT_OPTIONS, the backend allowlist (backend/src/collections/collection-sort.ts) and the admin
// picker (admin/lib/collection-sort.ts); a test pins the page's list to this one.
export const COLLECTION_SORT_KEYS = [
  "best_selling",
  "newest",
  "oldest",
  "az",
  "za",
  "price_asc",
  "price_desc",
] as const;
export type CollectionSortKey = (typeof COLLECTION_SORT_KEYS)[number];

export function asSortKey(value: unknown): CollectionSortKey | null {
  return typeof value === "string" && (COLLECTION_SORT_KEYS as readonly string[]).includes(value)
    ? (value as CollectionSortKey)
    : null;
}

export function resolveCollectionSort(opts: {
  picked?: unknown; // chosen by the customer in this visit
  urlSort?: unknown; // ?sort=
  defaultSort?: unknown; // the collection's own default
}): CollectionSortKey {
  return asSortKey(opts.picked) ?? asSortKey(opts.urlSort) ?? asSortKey(opts.defaultSort) ?? "newest";
}
