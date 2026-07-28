-- CreateTable: staff-only, append-only order note thread (#4).
CREATE TABLE `ordernote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `authorUserId` INTEGER NOT NULL,
    `note` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `OrderNote_orderId_fkey` ON `ordernote`(`orderId`);
CREATE INDEX `OrderNote_authorUserId_fkey` ON `ordernote`(`authorUserId`);

ALTER TABLE `ordernote` ADD CONSTRAINT `OrderNote_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ordernote` ADD CONSTRAINT `OrderNote_authorUserId_fkey` FOREIGN KEY (`authorUserId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
