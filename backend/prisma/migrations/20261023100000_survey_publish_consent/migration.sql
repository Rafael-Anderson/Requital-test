-- Real reviews only. Additive: two nullable columns on surveyresponse, nothing
-- existing is altered and nothing is backfilled.
--
-- publishConsent: NULL = unknown (every row that predates this migration, and
-- any row submitted by a client that did not send the field), 1 = the customer
-- ticked "You may show my feedback on the store's website", 0 = the customer
-- submitted the new form with it unticked (or withdrew via account deletion).
-- A NULL is never treated as consent.
--
-- featuredAt: NULL = not shown on the storefront, otherwise when the merchant
-- chose to show it. Serving also re-checks publishConsent = 1 and a non-empty
-- comment at read time, so this column alone never publishes anything.
--
-- The index backs the one public read (a shop's featured reviews, newest first).
ALTER TABLE `surveyresponse`
    ADD COLUMN `publishConsent` TINYINT NULL,
    ADD COLUMN `featuredAt` DATETIME(3) NULL;

CREATE INDEX `SurveyResponse_shopId_featuredAt_idx` ON `surveyresponse`(`shopId`, `featuredAt`);
