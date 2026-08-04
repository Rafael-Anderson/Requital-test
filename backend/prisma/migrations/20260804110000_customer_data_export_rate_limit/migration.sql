-- UAE PDPL data export rate limit (max 1 request per customer per 24h).
-- See CustomerAccountService.exportData.

ALTER TABLE `customer` ADD COLUMN `lastDataExportAt` DATETIME(3) NULL;
