import { InternalServerErrorException } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { S3StorageProvider } from './s3-storage.provider';

// Mocks S3Client.prototype.send directly rather than pulling in a mocking
// library (e.g. aws-sdk-client-mock) — one method, hand-mocked, matches
// this codebase's existing convention of hand-rolled mocks over a mocking
// framework (see every *.spec.ts's createMockPrisma). No real network call
// is ever made in this file.
describe('S3StorageProvider', () => {
  const config = {
    endpoint: 'https://fake-r2-endpoint.example.com',
    bucket: 'test-bucket',
    region: 'auto',
    accessKeyId: 'fake-key',
    secretAccessKey: 'fake-secret',
  };

  let sendSpy: jest.SpyInstance;

  beforeEach(() => {
    sendSpy = jest.spyOn(S3Client.prototype, 'send');
  });

  afterEach(() => {
    sendSpy.mockRestore();
  });

  it('save() PUTs the object and returns a path-style URL', async () => {
    sendSpy.mockResolvedValue({});
    const provider = new S3StorageProvider(config);

    const result = await provider.save({
      key: 'products/42/abc123.jpg',
      buffer: Buffer.from('fake-bytes'),
      contentType: 'image/jpeg',
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0] as {
      input: { Bucket: string; Key: string; ContentType: string };
    };
    expect(command.input.Bucket).toBe('test-bucket');
    expect(command.input.Key).toBe('products/42/abc123.jpg');
    expect(command.input.ContentType).toBe('image/jpeg');
    expect(result).toEqual({
      key: 'products/42/abc123.jpg',
      url: 'https://fake-r2-endpoint.example.com/test-bucket/products/42/abc123.jpg',
    });
  });

  it('strips a trailing slash from the configured endpoint before building URLs', async () => {
    sendSpy.mockResolvedValue({});
    const provider = new S3StorageProvider({
      ...config,
      endpoint: 'https://fake-r2-endpoint.example.com/',
    });

    const result = await provider.save({
      key: 'products/1/x.jpg',
      buffer: Buffer.from('x'),
      contentType: 'image/jpeg',
    });

    expect(result.url).toBe(
      'https://fake-r2-endpoint.example.com/test-bucket/products/1/x.jpg',
    );
  });

  it('save() wraps an S3 failure in a clean 500, not a raw SDK error', async () => {
    sendSpy.mockRejectedValue(new Error('connection refused'));
    const provider = new S3StorageProvider(config);

    await expect(
      provider.save({
        key: 'products/1/x.jpg',
        buffer: Buffer.from('x'),
        contentType: 'image/jpeg',
      }),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('delete() sends a DeleteObjectCommand for the given key', async () => {
    sendSpy.mockResolvedValue({});
    const provider = new S3StorageProvider(config);

    await provider.delete('products/42/abc123.jpg');

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0] as {
      input: { Bucket: string; Key: string };
    };
    expect(command.input.Bucket).toBe('test-bucket');
    expect(command.input.Key).toBe('products/42/abc123.jpg');
  });

  it('delete() wraps an S3 failure in a clean 500', async () => {
    sendSpy.mockRejectedValue(new Error('access denied'));
    const provider = new S3StorageProvider(config);

    await expect(provider.delete('products/1/x.jpg')).rejects.toThrow(
      InternalServerErrorException,
    );
  });
});
