import { dirname, join } from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';
import { Injectable } from '@nestjs/common';
import type {
  SaveFileInput,
  SavedFile,
  StorageProvider,
} from '../storage-provider.interface';

// ponytail: local disk storage — fine for a single dev/staging instance,
// does not survive container redeploys or horizontal scaling (see
// docs/audit-2026-08.md §1.3, and the S3-compatible provider alongside this
// one for the real fix). Unchanged root/serving path from before this
// phase — main.ts still serves this directory at the /uploads/ prefix, and
// every file written before Phase 6 (no shopId path segment) keeps
// resolving exactly as it did; only the key shape for *new* uploads changed
// (see StorageService).
export const UPLOAD_ROOT = join(process.cwd(), 'uploads');

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';

  async save(input: SaveFileInput): Promise<SavedFile> {
    const fullPath = join(UPLOAD_ROOT, input.key);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, input.buffer);
    return { key: input.key, url: `/uploads/${input.key}` };
  }

  async delete(key: string): Promise<void> {
    const fullPath = join(UPLOAD_ROOT, key);
    await rm(fullPath, { force: true });
  }
}
