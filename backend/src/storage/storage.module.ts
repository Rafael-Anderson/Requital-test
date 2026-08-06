import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { resolveStorageProvider } from './storage-provider.factory';
import { UploadsController } from './uploads.controller';

@Module({
  controllers: [UploadsController],
  providers: [
    // Resolved once at module registration — same "construct the
    // env-driven strategy via useFactory" shape as AllExceptionsFilter's
    // ErrorTrackingProvider in app.module.ts, and for the same reason: a
    // misconfigured STORAGE_PROVIDER=s3 (missing S3_* vars) should fail
    // loudly at boot, not confusingly on the first upload request.
    {
      provide: StorageService,
      useFactory: () => new StorageService(resolveStorageProvider()),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
