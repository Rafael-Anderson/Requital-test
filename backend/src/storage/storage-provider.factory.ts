import type { StorageProvider } from './storage-provider.interface';
import { LocalStorageProvider } from './providers/local-storage.provider';
import { S3StorageProvider } from './providers/s3-storage.provider';

const S3_REQUIRED_VARS = [
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

// Resolved once at module registration (see storage.module.ts) — same
// "resolve by env presence, fail loudly if the chosen option is
// misconfigured" shape as resolveErrorTrackingProvider(). STORAGE_PROVIDER
// unset or 'local' keeps today's behavior (no env changes required for any
// existing deployment); 's3' requires all five S3_* vars or the app refuses
// to boot with a clear error naming what's missing, rather than failing
// confusingly on the first upload request.
export function resolveStorageProvider(): StorageProvider {
  const provider = (process.env.STORAGE_PROVIDER ?? 'local').toLowerCase();

  if (provider === 'local') {
    return new LocalStorageProvider();
  }

  if (provider === 's3') {
    const missing = S3_REQUIRED_VARS.filter((name) => !process.env[name]);
    if (missing.length > 0) {
      throw new Error(
        `STORAGE_PROVIDER=s3 requires ${missing.join(', ')} to be set`,
      );
    }
    return new S3StorageProvider({
      endpoint: process.env.S3_ENDPOINT!,
      bucket: process.env.S3_BUCKET!,
      region: process.env.S3_REGION!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    });
  }

  throw new Error(
    `Unknown STORAGE_PROVIDER "${provider}" — must be "local" or "s3"`,
  );
}
