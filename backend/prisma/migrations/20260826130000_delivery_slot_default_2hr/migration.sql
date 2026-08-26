-- Delivery time slots move from a 1-hour to a 2-hour default (storefront
-- checkout redesign — see checkout's DeliverySlotPicker). Applies to every
-- shop currently sitting at the old default (60) — can't distinguish "never
-- touched this setting" from "deliberately chose 60," so this favors the new
-- intended default for the common case. A shop already customized to some
-- other value (e.g. 45, 90) is left untouched.
ALTER TABLE `shop` MODIFY COLUMN `deliveryTimeSlotGapMinutes` INTEGER NOT NULL DEFAULT 120;
UPDATE `shop` SET `deliveryTimeSlotGapMinutes` = 120 WHERE `deliveryTimeSlotGapMinutes` = 60;
