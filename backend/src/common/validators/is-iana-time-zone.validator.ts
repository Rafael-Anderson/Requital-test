import { registerDecorator, type ValidationOptions } from 'class-validator';

// True when the runtime's Intl database knows the zone. Every consumer of
// shop.timezone formats dates with Intl.DateTimeFormat({ timeZone }), which
// throws a RangeError on an unknown name, so a bad stored value would break
// slot generation, the dashboard and the storefront's date maths for that shop.
export function isValidTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function IsIanaTimeZone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isIanaTimeZone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: isValidTimeZone,
        defaultMessage() {
          return 'timezone must be a valid IANA time zone, e.g. Asia/Dubai';
        },
      },
    });
  };
}
