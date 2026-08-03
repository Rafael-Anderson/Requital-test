-- Business Settings "Coming Soon" toggles wired up for real: product
-- attributes, product FAQs, dual-mode disabled-cart, post-purchase survey.
-- Also drops disableGoogleMaps (stale — Google Maps was already replaced by
-- Leaflet+Nominatim elsewhere, the toggle referred to nothing real).

-- ============ Shop: drop disableGoogleMaps, add cartDisabledMode ============
ALTER TABLE `shop` DROP COLUMN `disableGoogleMaps`;
ALTER TABLE `shop` ADD COLUMN `cartDisabledMode` VARCHAR(191) NOT NULL DEFAULT 'buy_now';

-- ============ CreateTable: productattribute ============
CREATE TABLE `productattribute` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `ProductAttribute_productId_fkey` ON `productattribute`(`productId`);

ALTER TABLE `productattribute` ADD CONSTRAINT `ProductAttribute_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ============ CreateTable: productfaq ============
CREATE TABLE `productfaq` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `question` VARCHAR(191) NOT NULL,
    `answer` TEXT NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `ProductFaq_productId_fkey` ON `productfaq`(`productId`);

ALTER TABLE `productfaq` ADD CONSTRAINT `ProductFaq_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ============ CreateTable: surveyresponse ============
CREATE TABLE `surveyresponse` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `orderId` INTEGER NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `rating` INTEGER NULL,
    `comment` TEXT NULL,
    `respondedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `SurveyResponse_orderId_key` ON `surveyresponse`(`orderId`);
CREATE UNIQUE INDEX `SurveyResponse_token_key` ON `surveyresponse`(`token`);
CREATE INDEX `SurveyResponse_shopId_fkey` ON `surveyresponse`(`shopId`);

ALTER TABLE `surveyresponse` ADD CONSTRAINT `SurveyResponse_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `surveyresponse` ADD CONSTRAINT `SurveyResponse_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
