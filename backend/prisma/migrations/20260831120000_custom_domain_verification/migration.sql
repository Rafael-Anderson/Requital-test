-- Custom-domain verification groundwork (Phase 1 of docs/plans/custom-domain-resolver.md).
-- Additive only. These columns sit UNUSED until Phase 2 wires the ownership-
-- verification flow: nothing reads or writes them yet, and no existing shop's
-- behaviour changes. Plain VARCHAR (not ENUM), matching domainType's own
-- "not an ENUM" precedent in 20260811120000_shop_domain_config.
--   customDomainStatus: NULL = no custom-domain claim; otherwise one of
--     'pending' | 'verifying' | 'verified' | 'failed'
--   customDomainVerifyToken: per-claim token the merchant puts in a DNS TXT
--     record (`_requital-verify.<domain>`); minted and checked in Phase 2.
--   customDomainVerifiedAt: set when a claim first reaches 'verified'.
ALTER TABLE `shop` ADD COLUMN `customDomainStatus` VARCHAR(16) NULL;
ALTER TABLE `shop` ADD COLUMN `customDomainVerifyToken` VARCHAR(64) NULL;
ALTER TABLE `shop` ADD COLUMN `customDomainVerifiedAt` DATETIME(3) NULL;
