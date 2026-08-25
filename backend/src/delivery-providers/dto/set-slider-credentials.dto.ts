import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { SLIDER_BASE_URLS } from '../slider/slider.constants';

export class SetSliderCredentialsDto {
  // Optional so the admin settings page can save accountId/environment
  // changes (or just re-save the webhook token) without forcing the API key
  // to be retyped every time — SliderSettingsService.setCredentials keeps
  // the previously-saved key when this is omitted, and rejects the save
  // outright if there's no previous key to fall back to either (first-time
  // setup still needs a real key).
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  apiKey?: string;

  @IsString()
  @IsNotEmpty()
  accountId: string;

  // Optional both for "Slider webhook auth is optional per the API docs"
  // and for the same leave-blank-to-keep-current-value convenience as
  // apiKey above — omitted means "don't change it," not "clear it."
  @IsOptional()
  @IsString()
  webhookToken?: string;

  @IsIn(Object.keys(SLIDER_BASE_URLS))
  environment: keyof typeof SLIDER_BASE_URLS;
}
