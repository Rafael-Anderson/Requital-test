export const MENU_ITEM_TYPES = ['LINK', 'DROPDOWN'] as const;
export type MenuItemType = (typeof MENU_ITEM_TYPES)[number];
