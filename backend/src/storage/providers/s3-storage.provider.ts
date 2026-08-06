import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type {
  SaveFileInput,
  SavedFile,
  StorageProvider,
} from '../storage-provider.interface';

export interface S3ProviderConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// Works against AWS S3 or any S3-compatible endpoint (Cloudflare R2, MinIO,
// ...) via the same env-driven config — @aws-sdk/client-s3's `endpoint`
// option is exactly what makes this provider-agnostic; nothing here is
// AWS-specific. Path-style URLs (<endpoint>/<bucket>/<key>), not
// virtual-hosted-style (<bucket>.<endpoint>) — path-style is the one shape
// that works uniformly across R2/MinIO/S3 without per-vendor DNS
// conventions, which matters here since "any S3-compatible endpoint" is the
// explicit requirement.
@Injectable()
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;

  constructor(config: S3ProviderConfig) {
    this.bucket = config.bucket;
    this.endpoint = config.endpoint.replace(/\/+$/, '');
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Path-style addressing (see class comment) — required for MinIO and
      // most non-AWS S3-compatible endpoints; AWS itself still accepts it.
      forcePathStyle: true,
    });
  }

  async save(input: SaveFileInput): Promise<SavedFile> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.buffer,
          ContentType: input.contentType,
        }),
      );
    } catch (err) {
      throw new InternalServerErrorException(
        `S3 upload failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      key: input.key,
      url: `${this.endpoint}/${this.bucket}/${input.key}`,
    };
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (err) {
      throw new InternalServerErrorException(
        `S3 delete failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
