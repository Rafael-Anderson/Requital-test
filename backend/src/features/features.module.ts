import { Global, Module } from '@nestjs/common';
import { FeaturesService } from './features.service';

// Global like DatabaseModule: six unrelated modules read flags, and none
// should have to remember to import this one (forgetting would be a DI error
// at boot, not a silent bypass, but there is no reason to make it possible).
@Global()
@Module({
  providers: [FeaturesService],
  exports: [FeaturesService],
})
export class FeaturesModule {}
