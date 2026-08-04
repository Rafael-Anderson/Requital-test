-- Back-in-stock "notify me" subscriptions. See NotifySubscriptionsService.

CREATE TABLE `notifysubscription` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `shopId` INT NOT NULL,
  `productId` INT NOT NULL,
  `variantId` INT NULL,
  `email` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `notifiedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `NotifySubscription_unique`(`shopId`, `productId`, `variantId`, `email`),
  INDEX `NotifySubscription_rateLimit_idx`(`shopId`, `email`, `createdAt`),
  INDEX `NotifySubscription_productId_fkey`(`productId`),
  INDEX `NotifySubscription_variantId_fkey`(`variantId`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `notifysubscription` ADD CONSTRAINT `NotifySubscription_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `notifysubscription` ADD CONSTRAINT `NotifySubscription_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `notifysubscription` ADD CONSTRAINT `NotifySubscription_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `productvariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
