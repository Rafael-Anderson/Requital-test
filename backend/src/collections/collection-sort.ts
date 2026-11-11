// The sort keys a customer can pick on the storefront collection page
// (storefront/app/[shop]/collections/[slug]/page.tsx SORT_OPTIONS). A collection's
// defaultSort must be one of these; NULL means the page's own default, Newest.
export const COLLECTION_SORT_KEYS = [
  'best_selling',
  'newest',
  'oldest',
  'az',
  'za',
  'price_asc',
  'price_desc',
] as const;
export type CollectionSortKey = (typeof COLLECTION_SORT_KEYS)[number];
