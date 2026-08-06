import { memoryStorage } from 'multer';

// Memory storage, not disk — real validation (magic-byte sniffing, per-shop
// key construction, resize) all happens in StorageService after the file is
// fully buffered, since multer's own fileFilter only ever sees metadata
// (fieldname/originalname/mimetype from the client's declared
// Content-Type), never the actual bytes — that header-trusting fileFilter
// was the exact gap docs/audit-2026-08.md §1.3 found. `limits.fileSize` is
// still enforced here as the primary defense (multer aborts the stream
// before an oversized file ever fully buffers in memory); StorageService's
// own size check is defense-in-depth on top of this, not a replacement.
//
// Shared by every image-upload endpoint (products, categories, ingredients,
// theme, bio-links, shop, seo, scan, collections) — same "one config, every
// call site" shape as before this phase, just without a subdir parameter:
// which feature/subdirectory a file belongs under is now StorageService's
// concern (passed explicitly at the call site), not baked into multer's
// disk destination.
const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_SIZE_MB) || 10) * 1024 * 1024;

export function createImageUploadOptions() {
  return {
    storage: memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES },
  };
}
