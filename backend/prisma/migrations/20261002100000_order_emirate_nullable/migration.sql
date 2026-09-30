-- Phase 2b / PR-B: `order.emirate` becomes nullable, the first step of removing
-- it (draftorder.emirate and outlet.emirate already are). From here an address
-- write stores `regionId` and mirrors the region's English name into `emirate`
-- for readers that have not moved yet; a shop whose country has no region model
-- has no name to mirror, and NULL is the honest value rather than a placeholder.
-- The column is dropped in the contract PR.
ALTER TABLE `order` MODIFY `emirate` VARCHAR(191) NULL;
