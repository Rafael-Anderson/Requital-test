import { ArrayNotEmpty, IsArray, IsInt } from 'class-validator';

// Wrapped in an object rather than the body being a bare array — every other
// DTO in this codebase validates an object body (class-validator's usual
// shape); a raw-array body would need a different validation pipe setup
// with no existing precedent here. Minor deviation from the task's literal
// "body = ordered array of ids" wording, flagged rather than silently
// matched by inventing a new validation pattern for just this one endpoint.
export class ReorderBioLinksDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  ids: number[];
}
