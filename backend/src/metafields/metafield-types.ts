// Pure definition/value validation for metafields. No DB, no Nest: everything
// the service decides about "is this value legal for this definition" lives
// here so it is unit-testable and cannot drift between create, edit and
// re-validation of stored values.

export const METAFIELD_OWNER_TYPES = [
  'product',
  'variant',
  'collection',
  'customer',
  'order',
  'outlet',
] as const;
export type MetafieldOwnerType = (typeof METAFIELD_OWNER_TYPES)[number];

// File and reference types are deliberately not here yet.
export const METAFIELD_TYPES = [
  'text',
  'multiline',
  'number',
  'boolean',
  'date',
  'json',
  'single_select',
  'multi_select',
] as const;
export type MetafieldType = (typeof METAFIELD_TYPES)[number];

// Owners whose values are personal or merchant-internal data: a definition
// for them can never be flagged as shown on the storefront, so a later public
// consumer cannot leak them by accident.
export const NEVER_PUBLIC_OWNER_TYPES: readonly MetafieldOwnerType[] = [
  'customer',
  'order',
];

export const MAX_DEFINITIONS_PER_OWNER_TYPE = 100;
export const MAX_OPTIONS = 100;
export const MAX_OPTION_LENGTH = 100;
const TEXT_CAP = 1000;
const MULTILINE_CAP = 10000;
const JSON_CAP = 10000;

export type ValidationConfig = Record<string, unknown>;

export class MetafieldInvalid extends Error {}

function fail(msg: string): never {
  throw new MetafieldInvalid(msg);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function intIn(
  cfg: Record<string, unknown>,
  key: string,
  lo: number,
  hi: number,
): number | undefined {
  const v = cfg[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) {
    fail(`validation.${key} must be an integer between ${lo} and ${hi}`);
  }
  return v;
}

function finiteNum(
  cfg: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = cfg[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e15) {
    fail(`validation.${key} must be a finite number`);
  }
  return v;
}

function onlyKeys(cfg: Record<string, unknown>, allowed: string[]) {
  for (const k of Object.keys(cfg)) {
    if (!allowed.includes(k)) {
      fail(`validation.${k} is not a valid setting for this field type`);
    }
  }
}

// Validates a definition's validation config and returns the normalised form
// that gets stored (null when the type takes no settings and none were given).
export function normalizeValidationConfig(
  type: MetafieldType,
  raw: unknown,
): ValidationConfig | null {
  if (raw === undefined || raw === null) {
    if (type === 'single_select' || type === 'multi_select') {
      fail('validation.options is required for a select field');
    }
    return null;
  }
  if (!isPlainObject(raw)) fail('validation must be an object');
  switch (type) {
    case 'text':
    case 'multiline': {
      onlyKeys(raw, ['minLength', 'maxLength']);
      const cap = type === 'text' ? TEXT_CAP : MULTILINE_CAP;
      const minLength = intIn(raw, 'minLength', 0, cap);
      const maxLength = intIn(raw, 'maxLength', 1, cap);
      if (
        minLength !== undefined &&
        maxLength !== undefined &&
        minLength > maxLength
      ) {
        fail('validation.minLength cannot exceed validation.maxLength');
      }
      return {
        ...(minLength !== undefined && { minLength }),
        ...(maxLength !== undefined && { maxLength }),
      };
    }
    case 'number': {
      onlyKeys(raw, ['min', 'max', 'integer']);
      const min = finiteNum(raw, 'min');
      const max = finiteNum(raw, 'max');
      if (min !== undefined && max !== undefined && min > max) {
        fail('validation.min cannot exceed validation.max');
      }
      if (raw.integer !== undefined && typeof raw.integer !== 'boolean') {
        fail('validation.integer must be true or false');
      }
      return {
        ...(min !== undefined && { min }),
        ...(max !== undefined && { max }),
        ...(raw.integer !== undefined && { integer: raw.integer }),
      };
    }
    case 'single_select':
    case 'multi_select': {
      onlyKeys(raw, ['options']);
      const options = raw.options;
      if (
        !Array.isArray(options) ||
        options.length < 1 ||
        options.length > MAX_OPTIONS
      ) {
        fail(`validation.options must list 1 to ${MAX_OPTIONS} options`);
      }
      const seen = new Set<string>();
      for (const o of options as unknown[]) {
        if (
          typeof o !== 'string' ||
          o.trim() === '' ||
          o.length > MAX_OPTION_LENGTH
        ) {
          fail(
            `each option must be a non-empty string of at most ${MAX_OPTION_LENGTH} characters`,
          );
        }
        if (seen.has(o)) fail(`duplicate option "${o}"`);
        seen.add(o);
      }
      return { options: options as string[] };
    }
    default:
      // boolean, date, json take no settings.
      if (Object.keys(raw).length > 0) {
        fail('this field type takes no validation settings');
      }
      return null;
  }
}

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

// Throws MetafieldInvalid when `value` is not legal for the definition; returns
// the value to store otherwise. `null`/undefined are NOT handled here: callers
// treat those as "remove the value" before validating.
export function validateMetafieldValue(
  type: MetafieldType,
  config: ValidationConfig | null,
  value: unknown,
): unknown {
  const cfg = config ?? {};
  switch (type) {
    case 'text':
    case 'multiline': {
      if (typeof value !== 'string') fail('value must be a string');
      const cap = type === 'text' ? TEXT_CAP : MULTILINE_CAP;
      const max = Math.min((cfg.maxLength as number | undefined) ?? cap, cap);
      const min = (cfg.minLength as number | undefined) ?? 0;
      if (value.length > max) fail(`value is longer than ${max} characters`);
      if (value.length < min) fail(`value is shorter than ${min} characters`);
      return value;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail('value must be a finite number');
      }
      if (cfg.integer === true && !Number.isInteger(value)) {
        fail('value must be a whole number');
      }
      if (typeof cfg.min === 'number' && value < cfg.min) {
        fail(`value is below the minimum of ${cfg.min}`);
      }
      if (typeof cfg.max === 'number' && value > cfg.max) {
        fail(`value is above the maximum of ${cfg.max}`);
      }
      return value;
    }
    case 'boolean':
      if (typeof value !== 'boolean') fail('value must be true or false');
      return value;
    case 'date':
      if (typeof value !== 'string' || !isRealDate(value)) {
        fail('value must be a real date in YYYY-MM-DD form');
      }
      return value;
    case 'json': {
      let serialised: string | undefined;
      try {
        serialised = JSON.stringify(value);
      } catch {
        fail('value is not valid JSON');
      }
      if (serialised === undefined) fail('value is not valid JSON');
      if (serialised.length > JSON_CAP) {
        fail(`value is larger than ${JSON_CAP} characters of JSON`);
      }
      return value;
    }
    case 'single_select': {
      const options = (cfg.options as string[] | undefined) ?? [];
      if (typeof value !== 'string' || !options.includes(value)) {
        fail('value must be one of the field options');
      }
      return value;
    }
    case 'multi_select': {
      const options = (cfg.options as string[] | undefined) ?? [];
      if (
        !Array.isArray(value) ||
        value.some((v) => typeof v !== 'string' || !options.includes(v)) ||
        new Set(value as string[]).size !== value.length
      ) {
        fail('value must be a list of distinct field options');
      }
      return value;
    }
  }
}
