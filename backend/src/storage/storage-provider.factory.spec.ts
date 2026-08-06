import { resolveStorageProvider } from './storage-provider.factory';
import { LocalStorageProvider } from './providers/local-storage.provider';
import { S3StorageProvider } from './providers/s3-storage.provider';

describe('resolveStorageProvider', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.STORAGE_PROVIDER;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;
    delete process.env.S3_REGION;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('defaults to LocalStorageProvider when STORAGE_PROVIDER is unset', () => {
    expect(resolveStorageProvider()).toBeInstanceOf(LocalStorageProvider);
  });

  it('resolves LocalStorageProvider explicitly for STORAGE_PROVIDER=local', () => {
    process.env.STORAGE_PROVIDER = 'local';
    expect(resolveStorageProvider()).toBeInstanceOf(LocalStorageProvider);
  });

  it('resolves S3StorageProvider when STORAGE_PROVIDER=s3 and every S3_* var is set', () => {
    process.env.STORAGE_PROVIDER = 's3';
    process.env.S3_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
    process.env.S3_BUCKET = 'my-bucket';
    process.env.S3_REGION = 'auto';
    process.env.S3_ACCESS_KEY_ID = 'key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';

    expect(resolveStorageProvider()).toBeInstanceOf(S3StorageProvider);
  });

  it('fails loudly at resolution time, naming what is missing, rather than booting with a broken provider', () => {
    process.env.STORAGE_PROVIDER = 's3';
    process.env.S3_BUCKET = 'my-bucket';
    // S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY unset.

    expect(() => resolveStorageProvider()).toThrow(/S3_ENDPOINT/);
    expect(() => resolveStorageProvider()).toThrow(/S3_REGION/);
    expect(() => resolveStorageProvider()).toThrow(/S3_ACCESS_KEY_ID/);
    expect(() => resolveStorageProvider()).toThrow(/S3_SECRET_ACCESS_KEY/);
  });

  it('rejects an unrecognized STORAGE_PROVIDER value', () => {
    process.env.STORAGE_PROVIDER = 'dropbox';
    expect(() => resolveStorageProvider()).toThrow(/Unknown STORAGE_PROVIDER/);
  });
});
