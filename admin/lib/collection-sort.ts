// The sort options a collection can open in. Keys and labels mirror the storefront collection
// page's own sort dropdown (storefront/app/[shop]/collections/[slug]/page.tsx SORT_OPTIONS) and
// the backend allowlist (backend/src/collections/collection-sort.ts); the apps share no code, so
// storefront/lib/collection-sort.ts carries the same list and a test in each app pins it.
export const COLLECTION_SORT_OPTIONS = [
  { value: "best_selling", label: "Best selling" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "az", label: "A to Z" },
  { value: "za", label: "Z to A" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
] as const;

export type CollectionSortKey = (typeof COLLECTION_SORT_OPTIONS)[number]["value"];

export function isCollectionSortKey(v: unknown): v is CollectionSortKey {
  return COLLECTION_SORT_OPTIONS.some((o) => o.value === v);
}
