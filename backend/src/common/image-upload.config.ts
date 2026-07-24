import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';

// ponytail: local disk storage — fine for a single dev/staging instance,
// does not survive container redeploys or horizontal scaling. Swapping to
// S3/Cloudinary/etc later only touches this file (destination + returned
// URL), nothing else in the products/categories modules.
export const UPLOAD_ROOT = join(process.cwd(), 'uploads');

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

// Shared by the products and categories upload endpoints — same
// destination/filename/validation logic, parameterized only by which
// subdirectory under uploads/ a given entity's images land in.
export function createImageUploadOptions(subdir: string) {
  const dir = join(UPLOAD_ROOT, subdir);
  return {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        cb(null, `${randomUUID()}${extname(file.originalname)}`);
      },
    }),
    fileFilter: (
      _req: unknown,
      file: Express.Multer.File,
      cb: (error: Error | null, acceptFile: boolean) => void,
    ) => {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(
          new BadRequestException(
            'Only JPEG, PNG, WebP, or GIF images are allowed',
          ),
          false,
        );
        return;
      }
      cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 },
  };
}
