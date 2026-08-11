-- Storefront domain configuration: a shop already has an immutable
-- `subdomain` (set at signup, used for /public/:shopSlug/... path-based
-- routing since day one) — this doesn't duplicate that column, it just adds
-- the ability to point the storefront at a real DNS hostname instead of the
-- default {subdomain}.requital.io, plus the toggle recording which one is
-- currently active. `domainType` is a plain string column (not an ENUM),
-- matching this schema's existing small-fixed-string-set convention (see
-- cartDisabledMode/productEditorMode).
ALTER TABLE `shop` ADD COLUMN `customDomain` VARCHAR(253) NULL;
ALTER TABLE `shop` ADD COLUMN `domainType` VARCHAR(20) NOT NULL DEFAULT 'subdomain';

ALTER TABLE `shop` ADD UNIQUE INDEX `Shop_customDomain_key`(`customDomain`);
