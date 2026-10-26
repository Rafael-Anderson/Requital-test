-- PLT-1 first slice: seed the plans and their feature matrix, then give every
-- existing shop a legacy subscription (docs/plans/phase3-billing.md sections 5, 7.2,
-- 19, 23). The whole file is idempotent: plans and features are insert-if-missing
-- (an edit made later by the platform is never overwritten), and each backfill is
-- INSERT ... WHERE NOT EXISTS, so re-running it changes nothing.
--
-- It changes no behaviour: the legacy plan entitles every registered key and has no
-- order ceiling, so FeaturesService resolves exactly what it did before. Proven by
-- backend/scripts/billing-flag-matrix.ts (before/after matrix + BIT_XOR checksums)
-- and test/billing-plt1.e2e-spec.ts. No price is seeded anywhere.
--
-- Working names T1/T2/T3 (tierN) and the placeholder ceilings 300 / 2000 / 10000
-- are the owner's section 23 defaults, to be replaced with real numbers.

INSERT INTO `plan` (`code`, `name`, `status`, `kind`, `isSelectable`, `orderSoftCeiling`, `sortOrder`)
VALUES
  ('legacy_free', 'Legacy (free)', 'active', 'legacy', 0, NULL, 0),
  ('tier1', 'Tier 1', 'active', 'standard', 1, 300, 1),
  ('tier2', 'Tier 2', 'active', 'standard', 1, 2000, 2),
  ('tier3', 'Tier 3', 'active', 'standard', 1, 10000, 3)
ON DUPLICATE KEY UPDATE `id` = `id`;

-- Section 7.2 mapping plus marketplace_channels (T3 only, a platform-cost intake
-- channel). auto_deduct_ingredient_stock is entitled on EVERY plan: gating it would
-- silently stop stock being deducted and drift the ledger (section 7.1). The trial
-- uses the tier2 row set (a trialing subscription points at tier2).
INSERT INTO `planfeature` (`planId`, `featureKey`, `entitled`)
SELECT p.`id`, f.`featureKey`, f.`entitled`
FROM (
  SELECT 'legacy_free' AS planCode, 'notify_email' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'legacy_free' AS planCode, 'low_stock_digest' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'legacy_free' AS planCode, 'auto_deduct_ingredient_stock' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'legacy_free' AS planCode, 'product_image_zoom' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'legacy_free' AS planCode, 'collection_menu' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'legacy_free' AS planCode, 'whatsapp_floating_button' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'legacy_free' AS planCode, 'abandoned_cart_recovery' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'legacy_free' AS planCode, 'customer_survey' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'legacy_free' AS planCode, 'slider' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'legacy_free' AS planCode, 'notify_customers_whatsapp' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'legacy_free' AS planCode, 'marketplace_channels' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier1' AS planCode, 'notify_email' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier1' AS planCode, 'low_stock_digest' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier1' AS planCode, 'auto_deduct_ingredient_stock' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier1' AS planCode, 'product_image_zoom' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier1' AS planCode, 'collection_menu' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier1' AS planCode, 'whatsapp_floating_button' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier1' AS planCode, 'abandoned_cart_recovery' AS featureKey, 0 AS entitled
  UNION ALL
  SELECT 'tier1' AS planCode, 'customer_survey' AS featureKey, 0 AS entitled
  UNION ALL
  SELECT 'tier1' AS planCode, 'slider' AS featureKey, 0 AS entitled
  UNION ALL
  SELECT 'tier1' AS planCode, 'notify_customers_whatsapp' AS featureKey, 0 AS entitled
  UNION ALL
  SELECT 'tier1' AS planCode, 'marketplace_channels' AS featureKey, 0 AS entitled
  UNION ALL
  SELECT 'tier2' AS planCode, 'notify_email' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier2' AS planCode, 'low_stock_digest' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier2' AS planCode, 'auto_deduct_ingredient_stock' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier2' AS planCode, 'product_image_zoom' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier2' AS planCode, 'collection_menu' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier2' AS planCode, 'whatsapp_floating_button' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier2' AS planCode, 'abandoned_cart_recovery' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier2' AS planCode, 'customer_survey' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier2' AS planCode, 'slider' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier2' AS planCode, 'notify_customers_whatsapp' AS featureKey, 0 AS entitled
  UNION ALL
  SELECT 'tier2' AS planCode, 'marketplace_channels' AS featureKey, 0 AS entitled
  UNION ALL
  SELECT 'tier3' AS planCode, 'notify_email' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier3' AS planCode, 'low_stock_digest' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier3' AS planCode, 'auto_deduct_ingredient_stock' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier3' AS planCode, 'product_image_zoom' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier3' AS planCode, 'collection_menu' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier3' AS planCode, 'whatsapp_floating_button' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier3' AS planCode, 'abandoned_cart_recovery' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier3' AS planCode, 'customer_survey' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier3' AS planCode, 'slider' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier3' AS planCode, 'notify_customers_whatsapp' AS featureKey, 1 AS entitled
  UNION ALL
  SELECT 'tier3' AS planCode, 'marketplace_channels' AS featureKey, 1 AS entitled
) f
JOIN `plan` p ON p.`code` = f.`planCode`
ON DUPLICATE KEY UPDATE `planId` = `planfeature`.`planId`;

-- Suspensions that exist today were all made by platform staff (the only writer of
-- suspendedAt before billing). They must never be auto-lifted by a payment.
UPDATE `shop` SET `suspensionReason` = 'platform'
WHERE `suspendedAt` IS NOT NULL AND `suspensionReason` IS NULL;

-- Every existing shop is grandfathered onto the legacy plan: active, source
-- legacy, no currency / interval / period / trial / Stripe id (unknown stays NULL).
INSERT INTO `shopsubscription` (`shopId`, `planId`, `status`, `source`)
SELECT s.`id`, p.`id`, 'active', 'legacy'
FROM `shop` s
JOIN `plan` p ON p.`code` = 'legacy_free'
WHERE NOT EXISTS (SELECT 1 FROM `shopsubscription` ss WHERE ss.`shopId` = s.`id`);

INSERT INTO `subscriptionevent` (`shopId`, `fromStatus`, `toStatus`, `fromPlanId`, `toPlanId`, `reason`, `actorType`)
SELECT ss.`shopId`, NULL, ss.`status`, NULL, ss.`planId`, 'backfill_legacy', 'system'
FROM `shopsubscription` ss
WHERE ss.`source` = 'legacy'
  AND NOT EXISTS (
    SELECT 1 FROM `subscriptionevent` e
    WHERE e.`shopId` = ss.`shopId` AND e.`reason` = 'backfill_legacy'
  );
