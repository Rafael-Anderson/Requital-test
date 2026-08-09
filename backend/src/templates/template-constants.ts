export const TEMPLATE_TYPES = ['MANUAL', 'RULE_BASED', 'COLLECTION_GROUP'] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];
