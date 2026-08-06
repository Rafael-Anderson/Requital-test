import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StorageService } from './storage.service';
import type {
  SaveFileInput,
  SavedFile,
  StorageProvider,
} from './storage-provider.interface';

// A real, valid 1x1 PNG — sharp (used for resizing) needs genuinely
// decodable image bytes, not just something that passes the magic-byte
// sniff check.
const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function fakeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'photo.png',
    encoding: '7bit',
    mimetype: 'image/png',
    buffer: VALID_PNG,
    size: VALID_PNG.length,
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  } as Express.Multer.File;
}

function createMockProvider() {
  const save = jest
    .fn<Promise<SavedFile>, [SaveFileInput]>()
    .mockImplementation((input) =>
      Promise.resolve({ key: input.key, url: `/uploads/${input.key}` }),
    );
  const del = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
  const provider: StorageProvider = { name: 'mock', save, delete: del };
  return { provider, save, delete: del };
}

describe('StorageService.uploadImage', () => {
  const originalMaxUploadSizeMb = process.env.MAX_UPLOAD_SIZE_MB;

  afterEach(() => {
    if (originalMaxUploadSizeMb === undefined) {
      delete process.env.MAX_UPLOAD_SIZE_MB;
    } else {
      process.env.MAX_UPLOAD_SIZE_MB = originalMaxUploadSizeMb;
    }
  });

  it('accepts a valid image and saves original + thumbnail + medium variants, shop-scoped', async () => {
    const { provider, save } = createMockProvider();
    const service = new StorageService(provider);

    const result = await service.uploadImage(42, 'products', fakeFile());

    expect(save).toHaveBeenCalledTimes(3);
    const keys = save.mock.calls.map(([input]) => input.key);
    expect(keys[0]).toMatch(/^products\/42\/[a-f0-9-]+\.png$/);
    expect(keys[1]).toMatch(/^products\/42\/[a-f0-9-]+_thumb\.png$/);
    expect(keys[2]).toMatch(/^products\/42\/[a-f0-9-]+_medium\.png$/);
    expect(result.url).toContain('products/42/');
    expect(result.thumbnailUrl).toContain('_thumb.png');
    expect(result.mediumUrl).toContain('_medium.png');
  });

  it('rejects a file with a real PDF payload disguised as .jpg — sniffing, not the declared extension/Content-Type, decides', async () => {
    const { provider, save } = createMockProvider();
    const service = new StorageService(provider);
    const pdfBytes = Buffer.from('%PDF-1.4\n%âãÏÓ\n', 'ascii');

    await expect(
      service.uploadImage(
        1,
        'products',
        fakeFile({
          originalname: 'invoice.jpg',
          mimetype: 'image/jpeg',
          buffer: pdfBytes,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects SVG content outright — never sanitized, always rejected', async () => {
    const { provider, save } = createMockProvider();
    const service = new StorageService(provider);
    const svgBytes = Buffer.from(
      '<?xml version="1.0"?><svg onload="alert(1)"></svg>',
      'ascii',
    );

    await expect(
      service.uploadImage(
        1,
        'products',
        fakeFile({
          originalname: 'logo.svg',
          mimetype: 'image/svg+xml',
          buffer: svgBytes,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects a path-traversal filename before ever touching the buffer', async () => {
    const { provider, save } = createMockProvider();
    const service = new StorageService(provider);

    await expect(
      service.uploadImage(
        1,
        'products',
        fakeFile({ originalname: '../../etc/passwd.png' }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects a file exceeding the configured size cap', async () => {
    process.env.MAX_UPLOAD_SIZE_MB = '1';
    const { provider, save } = createMockProvider();
    const service = new StorageService(provider);
    const oversized = Buffer.alloc(2 * 1024 * 1024, 0);

    await expect(
      service.uploadImage(1, 'products', fakeFile({ buffer: oversized })),
    ).rejects.toThrow(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('StorageService.deleteImage', () => {
  it('deletes the original and both variant keys when the shopId matches', async () => {
    const { provider, delete: del } = createMockProvider();
    const service = new StorageService(provider);

    await service.deleteImage(42, 'products/42/abc123.jpg');

    expect(del).toHaveBeenCalledTimes(3);
    expect(del.mock.calls.map(([k]) => k)).toEqual([
      'products/42/abc123.jpg',
      'products/42/abc123_thumb.jpg',
      'products/42/abc123_medium.jpg',
    ]);
  });

  it('404s (never deletes) when the key belongs to a different shop', async () => {
    const { provider, delete: del } = createMockProvider();
    const service = new StorageService(provider);

    await expect(
      service.deleteImage(999, 'products/42/abc123.jpg'),
    ).rejects.toThrow(NotFoundException);
    expect(del).not.toHaveBeenCalled();
  });

  it('404s for a pre-Phase-6 key with no shopId segment at all', async () => {
    const { provider, delete: del } = createMockProvider();
    const service = new StorageService(provider);

    await expect(
      service.deleteImage(42, 'products/abc123.jpg'),
    ).rejects.toThrow(NotFoundException);
    expect(del).not.toHaveBeenCalled();
  });
});
