import { registerDecorator, type ValidationOptions } from 'class-validator';
import {
  DISPOSABLE_EMAIL_MESSAGE,
  isDisposableEmailDomain,
} from '../disposable-email-domains';

// Applied to SignupDto.email so a throwaway address is refused by the same
// global ValidationPipe as any other bad field - a plain 400 with the usual
// message array, not a bespoke error shape the admin would have to special-case.
export function IsNotDisposableEmail(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotDisposableEmail',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return true; // @IsEmail owns that
          return !isDisposableEmailDomain(value);
        },
        defaultMessage() {
          return DISPOSABLE_EMAIL_MESSAGE;
        },
      },
    });
  };
}
