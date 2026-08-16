-- Newsletter section (storefront/components/theme-sections/NewsletterSection.tsx)
-- previously submitted to nothing at all (preventDefault + no-op) — this is
-- the real capture endpoint. A dedicated table rather than reusing
-- `customer`: customer.name/customer.phone are both NOT NULL and this widget
-- only ever collects an email, so shoehorning a signup in here would mean
-- fabricating a name/phone for someone who never gave one.
CREATE TABLE `newslettersubscriber` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `source` VARCHAR(64) NOT NULL DEFAULT 'newsletter_widget',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `newslettersubscriber_shopId_email_key` ON `newslettersubscriber` (`shopId`, `email`);

ALTER TABLE `newslettersubscriber` ADD CONSTRAINT `newslettersubscriber_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
