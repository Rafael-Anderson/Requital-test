-- Phase 2b / §6-E: point the existing address fields at `region`, and backfill.
-- Additive only. `order.emirate` stays exactly as it is (NOT NULL, still the
-- thing every reader uses); a later PR makes it nullable and a last one drops it.
--
-- NULL `regionId` is a real, permanent state with two meanings the backfill
-- report keeps apart: the source `emirate` was itself NULL (nothing to map; ten
-- production outlets), or it held a value that matched no region of the shop's
-- country. The first is normal, the second is a bug or a data problem to look at.
-- Neither is ever defaulted to a region: a guessed region is worse than none.

-- ── The shop's country as a code ────────────────────────────────────────────
-- `shop.country` is free text and stays the display string. The region check
-- needs an ISO code, derived here from the six names the signup wizard offers.
-- "Other", NULL and anything else stay NULL: unknown, not assumed.
ALTER TABLE `shop` ADD COLUMN `countryCode` CHAR(2) NULL;

UPDATE `shop` SET `countryCode` = CASE TRIM(`country`)
    WHEN 'United Arab Emirates' THEN 'AE'
    WHEN 'Saudi Arabia'         THEN 'SA'
    WHEN 'Kuwait'               THEN 'KW'
    WHEN 'Qatar'                THEN 'QA'
    WHEN 'Bahrain'              THEN 'BH'
    WHEN 'Oman'                 THEN 'OM'
    ELSE NULL
  END
WHERE `countryCode` IS NULL;

-- ── Region columns ──────────────────────────────────────────────────────────
ALTER TABLE `order`      ADD COLUMN `regionId` INTEGER NULL;
ALTER TABLE `draftorder` ADD COLUMN `regionId` INTEGER NULL;
ALTER TABLE `outlet`     ADD COLUMN `regionId` INTEGER NULL;

ALTER TABLE `order` ADD INDEX `Order_regionId_idx`(`regionId`);
ALTER TABLE `draftorder` ADD INDEX `DraftOrder_regionId_idx`(`regionId`);
ALTER TABLE `outlet` ADD INDEX `Outlet_regionId_idx`(`regionId`);

ALTER TABLE `order` ADD CONSTRAINT `Order_regionId_fkey`
    FOREIGN KEY (`regionId`) REFERENCES `region`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `draftorder` ADD CONSTRAINT `DraftOrder_regionId_fkey`
    FOREIGN KEY (`regionId`) REFERENCES `region`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `outlet` ADD CONSTRAINT `Outlet_regionId_fkey`
    FOREIGN KEY (`regionId`) REFERENCES `region`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Delivery zones: a set of regions, plus a merchant's confirmation ───────
-- Composite PK, like every other join table here. A zone deleted takes its
-- memberships with it; a region can never be deleted out from under a zone.
CREATE TABLE `deliveryzoneregion` (
    `zoneId` INTEGER NOT NULL,
    `regionId` INTEGER NOT NULL,

    INDEX `DeliveryZoneRegion_regionId_idx`(`regionId`),
    PRIMARY KEY (`zoneId`, `regionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `deliveryzoneregion` ADD CONSTRAINT `DeliveryZoneRegion_zoneId_fkey`
    FOREIGN KEY (`zoneId`) REFERENCES `deliveryzone`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `deliveryzoneregion` ADD CONSTRAINT `DeliveryZoneRegion_regionId_fkey`
    FOREIGN KEY (`regionId`) REFERENCES `region`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- NULL until a merchant reviews the zone's region mapping. A shop keeps the old
-- name-based zone matching until every one of its active zones is confirmed.
ALTER TABLE `deliveryzone` ADD COLUMN `mappingConfirmedAt` DATETIME(3) NULL;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Every statement below is idempotent (`regionId IS NULL`) and is re-run against
-- fixtures by test/region-backfill.e2e-spec.ts. Keep each one a single UPDATE.
UPDATE `order` o
  JOIN `shop` s ON s.`id` = o.`shopId`
  JOIN `region` r ON r.`countryCode` = s.`countryCode` AND r.`nameEn` = TRIM(o.`emirate`)
   SET o.`regionId` = r.`id`
 WHERE o.`regionId` IS NULL;

UPDATE `draftorder` d
  JOIN `shop` s ON s.`id` = d.`shopId`
  JOIN `region` r ON r.`countryCode` = s.`countryCode` AND r.`nameEn` = TRIM(d.`emirate`)
   SET d.`regionId` = r.`id`
 WHERE d.`regionId` IS NULL;

UPDATE `outlet` ot
  JOIN `shop` s ON s.`id` = ot.`shopId`
  JOIN `region` r ON r.`countryCode` = s.`countryCode` AND r.`nameEn` = TRIM(ot.`emirate`)
   SET ot.`regionId` = r.`id`
 WHERE ot.`regionId` IS NULL;
