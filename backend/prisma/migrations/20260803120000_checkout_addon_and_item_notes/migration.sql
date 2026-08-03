-- Checkout add-ons (product.isCheckoutAddon, offered in a storefront
-- checkout popup) and a per-order-item customer note (orderitem.note,
-- typed on the PDP, shown to staff on the live-orders kanban card and
-- order detail modal).

ALTER TABLE `product` ADD COLUMN `isCheckoutAddon` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `orderitem` ADD COLUMN `note` VARCHAR(255) NULL;
