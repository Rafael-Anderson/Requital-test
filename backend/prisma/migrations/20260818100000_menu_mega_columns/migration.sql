-- Mega menu support (storefront-v2 Phase 1). MEGA menu items organize their
-- sub-items into named columns, each column an ordered list of links
-- (collection / product / custom URL) with an optional "featured" flag.
-- Real tables, mirroring menuitemcollection's existing join-table pattern --
-- menu items are a real admin-CRUD entity independent of the theme
-- builder's block tree, so this data doesn't belong in theme config JSON.

CREATE TABLE `menucolumn` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `menuItemId` INT NOT NULL,
  `title` VARCHAR(100) NOT NULL,
  `sortOrder` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `MenuColumn_menuItemId_fkey` (`menuItemId`),
  CONSTRAINT `MenuColumn_menuItemId_fkey` FOREIGN KEY (`menuItemId`) REFERENCES `menuitem` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `menucolumnlink` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `menuColumnId` INT NOT NULL,
  `label` VARCHAR(100) NOT NULL,
  `linkType` VARCHAR(20) NOT NULL,
  `collectionId` INT DEFAULT NULL,
  `productId` INT DEFAULT NULL,
  `customUrl` VARCHAR(500) DEFAULT NULL,
  `featured` TINYINT(1) NOT NULL DEFAULT 0,
  `sortOrder` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `MenuColumnLink_menuColumnId_fkey` (`menuColumnId`),
  KEY `MenuColumnLink_collectionId_fkey` (`collectionId`),
  KEY `MenuColumnLink_productId_fkey` (`productId`),
  CONSTRAINT `MenuColumnLink_menuColumnId_fkey` FOREIGN KEY (`menuColumnId`) REFERENCES `menucolumn` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `MenuColumnLink_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `collection` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `MenuColumnLink_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
