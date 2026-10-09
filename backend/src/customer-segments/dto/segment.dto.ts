import { IsObject, IsString, MaxLength, MinLength } from 'class-validator';

// `rules` is validated by parseRules (segment-rules.ts), not by class-validator:
// the tree is recursive and discriminated, and the service rebuilds it from the
// checked values anyway.
export class SaveSegmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsObject()
  rules!: Record<string, unknown>;
}

export class PreviewSegmentDto {
  @IsObject()
  rules!: Record<string, unknown>;
}
