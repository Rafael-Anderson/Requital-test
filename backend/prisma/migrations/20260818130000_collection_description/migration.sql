-- Collection banner description (storefront-v2 Phase 2A) -- the collection
-- table had no free-text field at all before this; the new collection page
-- banner needs one for the muted description line under the collection name.
ALTER TABLE `collection` ADD COLUMN `description` TEXT DEFAULT NULL;
