-- INV-5: reorder points and reorder quantity.
--
-- ADDITIVE ONLY. Stock is per outlet (outletingredientstock, PK [outletId,
-- ingredientId]) while the ingredient is shop-wide, and a shop's outlets sell and
-- hold very different volumes, so the reorder point belongs on the per-outlet
-- stock row, next to (and distinct from) lowStockThreshold. lowStockThreshold is
-- the merchant's "tell me it is running low" alert (low-stock digest); reusing it
-- as a purchasing trigger would silently start suggesting purchase orders for
-- every merchant who ever set an alert, so the two stay separate columns.
--
-- Unknown stays NULL: no reorderPoint means "no suggestion", never 0 (a 0 point
-- would mean "reorder when I am out"). reorderQuantity NULL means the merchant
-- has not said how much to order, so the item is listed but never auto-quantified.
ALTER TABLE `outletingredientstock`
    ADD COLUMN `reorderPoint` INTEGER NULL,
    ADD COLUMN `reorderQuantity` INTEGER NULL;
