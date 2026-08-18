export const MENU_ITEM_TYPES = ['LINK', 'DROPDOWN', 'MEGA'] as const;
export type MenuItemType = (typeof MENU_ITEM_TYPES)[number];

export const MENU_COLUMN_LINK_TYPES = ['COLLECTION', 'PRODUCT', 'CUSTOM'] as const;
export type MenuColumnLinkType = (typeof MENU_COLUMN_LINK_TYPES)[number];
