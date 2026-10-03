import { IsOptional, IsString, MaxLength } from 'class-validator';

// Unauthenticated and spoofable: both fields are length-capped here and then
// reduced (path canonicalised with no query string, referrer to a bare host) in
// redirect-rules.ts before anything is stored.
export class LogNotFoundDto {
  @IsString()
  @MaxLength(1000)
  path: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  referrer?: string;
}
