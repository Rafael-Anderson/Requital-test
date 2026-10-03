-- ONB-4: URL redirect map + 404 log. Additive: two new tables, nothing existing
-- is altered.
--
-- urlredirect.fromPath is stored in the CANONICAL form produced by
-- url-redirects/redirect-rules.ts (lowercased, percent-encoded per segment, no
-- trailing slash, no query or fragment), so the unique index is an exact match
-- on what the storefront proxy looks up. utf8mb4_bin on the two path columns
-- keeps MySQL from folding what the application already canonicalised.
-- VARCHAR(512) utf8mb4 = 2048 bytes + shopId 4 = 2052, under the 3072 InnoDB
-- key limit.
--
-- notfoundlog is ADVISORY, written by an unauthenticated endpoint: it holds only
-- a path (no query string) and a referrer HOST, both length-capped, and the
-- application caps distinct paths per shop.
CREATE TABLE `urlredirect` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `fromPath` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `toTarget` VARCHAR(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `statusCode` SMALLINT NOT NULL DEFAULT 301,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `hitCount` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `lastHitAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `urlredirect_shopId_fromPath_key`(`shopId`, `fromPath`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `urlredirect` ADD CONSTRAINT `urlredirect_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `notfoundlog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `path` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `hitCount` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastReferrer` VARCHAR(255) NULL,

    UNIQUE INDEX `notfoundlog_shopId_path_key`(`shopId`, `path`),
    INDEX `notfoundlog_shopId_hitCount_idx`(`shopId`, `hitCount`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `notfoundlog` ADD CONSTRAINT `notfoundlog_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
