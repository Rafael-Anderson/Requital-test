import { randomBytes, randomUUID } from 'crypto';
import sharp from 'sharp';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { StorageProvider } from './storage-provider.interface';
import { sniffImageType } from './image-sniff';
import { isFilenameSafe } from './filename';
import { resizeImage } from './resize-image';
import {
  buildImageKey,
  deriveVariantKeys,
  extractShopIdFromKey,
} from './storage-key';

export const THUMBNAIL_WIDTH = 200;
export const MEDIUM_WIDTH = 600;

// Configurable (docs/audit-2026-08.md §1.3 found a 5MB cap already
// enforced via multer's `limits.fileSize`); this is a second, explicit
// check inside the service — multer's limit stops an oversized file from
// ever fully buffering in memory (the primary defense), this is
// defense-in-depth plus a clean, typed error instead of a raw multer
// stream error if the two ever drift apart.
function getMaxUploadBytes(): number {
  const mb = Number(process.env.MAX_UPLOAD_SIZE_MB) || 10;
  return mb * 1024 * 1024;
}

export interface UploadImageResult {
  // Unchanged meaning from before Phase 6 — the original, full-size image.
  // Every existing caller reading `.url` off this response keeps working
  // identically; thumbnailUrl/mediumUrl are additive.
  url: string;
  thumbnailUrl: string;
  mediumUrl: string;
}

// The single entry point every image-upload controller routes through
// (mirrors createImageUploadOptions being the single shared multer config
// before this phase) — validates real content (not the declared
// Content-Type), generates resized variants, and persists all three
// through whichever StorageProvider is active.
export class StorageService {
  constructor(private readonly provider: StorageProvider) {}

  async uploadImage(
    shopId: number,
    subdir: string,
    file: Express.Multer.File,
  ): Promise<UploadImageResult> {
    if (!isFilenameSafe(file.originalname)) {
      throw new BadRequestException('Invalid filename');
    }

    const maxBytes = getMaxUploadBytes();
    if (file.buffer.length > maxBytes) {
      throw new BadRequestException(
        `File exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB upload limit`,
      );
    }

    // Real magic-byte sniffing — never the client's declared Content-Type
    // (see docs/audit-2026-08.md §1.3). Also what rejects SVG: XML text
    // never matches a binary image signature, so it falls straight into
    // this same "unrecognized" branch with no SVG-specific special case.
    const sniffed = sniffImageType(file.buffer);
    if (!sniffed) {
      throw new BadRequestException(
        'Unrecognized or unsupported image format — only JPEG, PNG, WebP, and GIF are allowed',
      );
    }

    const id = randomUUID();
    const format = sniffed.ext === 'jpg' ? 'jpeg' : (sniffed.ext as 'png' | 'webp' | 'gif');

    const [thumbBuffer, mediumBuffer] = await Promise.all([
      resizeImage(file.buffer, THUMBNAIL_WIDTH, format),
      resizeImage(file.buffer, MEDIUM_WIDTH, format),
    ]);

    const [original, thumb, medium] = await Promise.all([
      this.provider.save({
        key: buildImageKey(subdir, shopId, id, '', sniffed.ext),
        buffer: file.buffer,
        contentType: sniffed.mime,
      }),
      this.provider.save({
        key: buildImageKey(subdir, shopId, id, 'thumb', sniffed.ext),
        buffer: thumbBuffer,
        contentType: sniffed.mime,
      }),
      this.provider.save({
        key: buildImageKey(subdir, shopId, id, 'medium', sniffed.ext),
        buffer: mediumBuffer,
        contentType: sniffed.mime,
      }),
    ]);

    return { url: original.url, thumbnailUrl: thumb.url, mediumUrl: medium.url };
  }

  // Scoped by the shopId embedded in the key itself (see
  // extractShopIdFromKey) — a key with no shopId segment (every pre-Phase-6
  // file) or a shopId that doesn't match the caller's own ctx.shopId 404s,
  // never a 403, so this can't be used to confirm another shop's file
  // exists. Deletes the original plus its _thumb/_medium variants in one
  // call since all three were always written together at upload time.
  async deleteImage(shopId: number, key: string): Promise<void> {
    const ownerShopId = extractShopIdFromKey(key);
    if (ownerShopId === null || ownerShopId !== shopId) {
      throw new NotFoundException('File not found');
    }
    await Promise.all(
      deriveVariantKeys(key).map((k) => this.provider.delete(k)),
    );
  }

  // Proof-of-delivery photo (SHP-5). Unlike uploadImage this is not a catalogue
  // image: it is re-encoded, stored once, and its URL is shown to STAFF only.
  //   - real content sniffing (never the declared Content-Type); JPEG/PNG/WebP only
  //   - a hard 5MB cap and a pixel cap before decoding (decompression bombs)
  //   - re-encoded to JPEG through sharp: EXIF (including GPS) is dropped, EXIF
  //     orientation is applied, and a polyglot/corrupt file fails to decode
  //   - the key carries 256 bits of randomness, so the URL is a capability that
  //     cannot be guessed; it lives under the shop's own namespace, so
  //     deleteProof can verify ownership from the key alone.
  async uploadProof(
    shopId: number,
    file: Express.Multer.File,
  ): Promise<{ key: string; url: string }> {
    if (!isFilenameSafe(file.originalname)) {
      throw new BadRequestException('Invalid filename');
    }
    if (file.buffer.length > PROOF_MAX_BYTES) {
      throw new BadRequestException('Photo is larger than 5MB');
    }
    const sniffed = sniffImageType(file.buffer);
    if (!sniffed || sniffed.ext === 'gif') {
      throw new BadRequestException('Photo must be a JPEG, PNG or WebP image');
    }
    let out: Buffer;
    try {
      out = await sharp(file.buffer, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Could not read that image');
    }
    const key = `delivery-proof/${shopId}/${randomBytes(32).toString('hex')}.jpg`;
    const saved = await this.provider.save({
      key,
      buffer: out,
      contentType: 'image/jpeg',
    });
    return { key: saved.key, url: saved.url };
  }

  async deleteProof(shopId: number, key: string): Promise<void> {
    const owner = extractShopIdFromKey(key);
    if (
      owner === null ||
      owner !== shopId ||
      !key.startsWith('delivery-proof/')
    ) {
      throw new NotFoundException('File not found');
    }
    await this.provider.delete(key);
  }
}

export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
