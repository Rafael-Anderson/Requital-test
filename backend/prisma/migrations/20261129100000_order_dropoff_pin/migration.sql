-- F1: the customer's own map pin for a storefront delivery order, kept so a
-- courier dispatch (Slider) can use it instead of re-geocoding the address text.
-- NULL = no pin (pickup, typed address with Maps unavailable, admin/draft orders,
-- every order placed before this). Never backfilled: what the shopper pinned was
-- not stored. Personal location data: nulled on customer anonymisation, never
-- returned to a client (stripAttribution). Additive only.
ALTER TABLE `order`
  ADD COLUMN `dropoffLatitude` DOUBLE NULL,
  ADD COLUMN `dropoffLongitude` DOUBLE NULL;
