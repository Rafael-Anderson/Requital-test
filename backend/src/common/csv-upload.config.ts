import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';

// memoryStorage, not disk (unlike createImageUploadOptions) — the file is
// parsed once and discarded, never served back. CSV mimetypes are
// inconsistent across browsers/OS (text/csv, application/vnd.ms-excel,
// application/csv, octet-stream...), so the filter checks the extension
// instead of sniffing mimetype.
export const csvUploadOptions = {
  storage: memoryStorage(),
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      cb(new BadRequestException('Only .csv files are accepted'), false);
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
};

// The platform importers (Salla, Zid) also take the .xlsx their dashboards
// export. Still memoryStorage and the same 5MB cap; the real parse (and its
// own zip-bomb caps) is common/table-file.ts. The extension decides, the
// content is never trusted.
export const tableUploadOptions = {
  ...csvUploadOptions,
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const name = file.originalname.toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
      cb(
        new BadRequestException('Only .csv and .xlsx files are accepted'),
        false,
      );
      return;
    }
    cb(null, true);
  },
};
