import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Platform-admin only (see platform-admin/) — a merchant has no access to
// Slider's own dashboard, so they can't set this themselves. See
// PlatformAdminController.
export class SetSliderAccountIdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  accountId: string;
}
