-- Product variants ships as an on-by-default feature going forward, and
-- existing shops get switched on too rather than left behind the new
-- default (no merchant has ever explicitly turned this off via the API —
-- see update-shop.dto.ts, it's only ever been set through the schema/DB
-- default up to this point).
ALTER TABLE `shop` ALTER COLUMN `productVariantsEnabled` SET DEFAULT true;

UPDATE `shop` SET `productVariantsEnabled` = true WHERE `productVariantsEnabled` = false;
