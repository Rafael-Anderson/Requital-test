export const COLLECTION_TYPES = ['MANUAL', 'RULE_BASED'] as const;
export type CollectionType = (typeof COLLECTION_TYPES)[number];
