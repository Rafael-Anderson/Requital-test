-- Custom-domain ownership verification (Phase 2 of docs/plans/custom-domain-resolver.md).
--
-- CD2 (locked): global uniqueness on a custom domain applies ONLY once a shop
-- has VERIFIED ownership via a DNS TXT record. Multiple shops may hold a
-- pending/verifying claim on the same hostname at once; whichever passes
-- verification first wins it exclusively. MySQL has no partial unique index, so
-- this is a STORED generated column that is NULL unless the row is verified,
-- plus a plain UNIQUE index over it (SQL NULLs never collide in a unique index).
-- First generated column in this schema — MySQL 8.0 (local + CI) supports it.
ALTER TABLE `shop`
  ADD COLUMN `customDomainClaimedAt` DATETIME(3) NULL,
  ADD COLUMN `customDomainLastCheckedAt` DATETIME(3) NULL,
  ADD COLUMN `customDomainVerifiedKey` VARCHAR(253)
    GENERATED ALWAYS AS (
      IF(`customDomainStatus` = 'verified', `customDomain`, NULL)
    ) STORED;

-- Replace the unconditional unique with the verified-only one. The old index
-- would 409 a second shop's *pending* claim, which CD2 forbids; exclusivity is
-- now enforced solely at the instant a claim flips to 'verified'. Keep a plain
-- (non-unique) index on customDomain so resolveSubdomain / the Caddy `ask`
-- lookup stays indexed (hit on every storefront request / TLS handshake).
ALTER TABLE `shop` DROP INDEX `Shop_customDomain_key`;
ALTER TABLE `shop` ADD INDEX `Shop_customDomain_idx` (`customDomain`);
ALTER TABLE `shop` ADD UNIQUE INDEX `Shop_customDomainVerifiedKey_key` (`customDomainVerifiedKey`);
ALTER TABLE `shop` ADD INDEX `Shop_customDomainSweep_idx` (`customDomainStatus`, `customDomainLastCheckedAt`);

-- One-off SCOPED grandfather. irmain.com is a real, currently-live (published)
-- merchant custom domain ("Irmain Perfums", prod shop id 7) that predates this
-- verification system. It is trusted as 'verified' here to avoid a storefront
-- outage on the deploy that turns verification on. This is a DELIBERATE,
-- one-time exception on the operator's say-so — NOT proof the DNS-TXT flow was
-- exercised end to end on a real domain. Flagged as a fast-follow in
-- docs/plans/custom-domain-resolver.md Phase 2 and CLAUDE.md: irmain.com should
-- be put through the real POST /shop/domain/verify flow at the next chance.
--
-- Exact-string match ONLY. Every other domainType='custom' row gets no backfill
-- and becomes NULL/unverified (the intended Phase 2 default): ~128 *.example.com
-- e2e leftovers in the shared dev DB, plus prod's arabianrentals.com and
-- irmain.online (both unpublished). No-op on a fresh CI database.
UPDATE `shop`
  SET `customDomainStatus` = 'verified',
      `customDomainVerifiedAt` = NOW(3),
      `customDomainClaimedAt` = NOW(3)
  WHERE `customDomain` = 'irmain.com'
    AND `domainType` = 'custom';
