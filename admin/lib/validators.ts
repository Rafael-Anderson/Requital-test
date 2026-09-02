// Pure field validators (and, below, matching normalize* functions) for the
// Account Setup wizard (components/AccountSetup.tsx / lib/useAccountSetupForm.ts)
// and reused wherever else phone/website/TRN fields are entered (customer
// edit, outlet edit). Kept framework-free and colocated with their regexes
// so lib/validators.test.ts can exercise them directly. backend/src/common/normalize.ts
// and backend/src/auth/dto/signup.dto.ts mirror this file's regexes and
// normalization logic by hand — there's no shared package between the two
// apps to import from (see CLAUDE.md's cross-app duplication note).

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
// Validated post-normalization (see normalizePhone below, called onBlur
// before this ever runs) — so this only needs to match the canonical E.164
// shape, not every raw format a user might type.
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[@#$%^&*!?]).{8,}$/;
// Also validated post-normalization (normalizeTrn strips dashes/spaces
// before this runs) — lenient on the digit count since UAE TRNs are usually
// a longer digit string, not a real checksum.
const TRN_REGEX = /^\d{8,17}$/;
const URL_REGEX = /^https?:\/\//i;

const UAE_COUNTRY_CODE = "971";

// Mirrors backend/src/shop/constants.ts's RESERVED_SUBDOMAINS by hand (no
// shared package between the two apps — see this file's header comment).
export const RESERVED_SUBDOMAINS = [
  "www",
  "api",
  "admin",
  "mail",
  "requital",
  "app",
  "dashboard",
  "static",
  "cdn",
];
const SUBDOMAIN_REGEX = /^[a-z0-9-]+$/;
// Mirrors backend/src/shop/domain-validation.ts's HOSTNAME_REGEX by hand.
const CUSTOM_DOMAIN_REGEX =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,63}$/;
// Mirrors backend/src/shop/domain-validation.ts's PLATFORM_ROOT_DOMAIN /
// isPlatformOwnedHost by hand. KEEP IN SYNC: a "custom" domain must never be a
// Requital-owned hostname (the bare apex, anything under *.requital.io, or a
// bare reserved label).
const PLATFORM_ROOT_DOMAIN = "requital.io";
function isPlatformOwnedHost(value: string): boolean {
  return (
    value === PLATFORM_ROOT_DOMAIN ||
    value.endsWith(`.${PLATFORM_ROOT_DOMAIN}`) ||
    RESERVED_SUBDOMAINS.includes(value)
  );
}

export function validateEmail(value: string): ValidationResult {
  if (!value.trim()) return { valid: false, message: "Email is required" };
  if (!EMAIL_REGEX.test(value.trim())) {
    return { valid: false, message: "Enter a valid email (e.g., name@example.com)" };
  }
  return { valid: true };
}

export function validatePhone(value: string): ValidationResult {
  if (!value.trim()) return { valid: false, message: "Phone number is required" };
  if (!PHONE_REGEX.test(value.trim())) {
    return { valid: false, message: "Enter a valid phone number" };
  }
  return { valid: true };
}

// On-blur transform for the phone field: strips spaces/dashes so the stored
// value is validation-friendly, without touching what the user sees while
// still typing.
export function stripPhoneFormatting(value: string): string {
  return value.replace(/[\s-]/g, "");
}

// Mirrors backend/src/common/normalize.ts's normalizePhoneToE164 by hand (no
// shared package between the two apps — see this file's header comment).
// UAE-scoped, same reasoning as the backend copy: accepts local ("0501234567"),
// bare-country-code ("971501234567"), or full E.164 ("+971501234567") input
// and normalizes to E.164. Returns the input unchanged (not null) when it
// can't be parsed, so the caller can still hand it to validatePhone() for a
// real error message instead of silently discarding what was typed.
export function normalizePhone(raw: string): string {
  if (!raw) return raw;
  let digits = raw.trim().replace(/[\s\-()]/g, "");

  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = UAE_COUNTRY_CODE + digits.slice(1);
  } else if (!digits.startsWith(UAE_COUNTRY_CODE)) {
    digits = UAE_COUNTRY_CODE + digits;
  }

  if (!/^\d{8,15}$/.test(digits)) return raw;
  return `+${digits}`;
}

// wa.me wants bare digits (no leading +), unlike the E.164 shape
// normalizePhone already returns — strip it rather than duplicating the
// normalization logic. A phone that doesn't normalize cleanly (raw returned
// unchanged, per normalizePhone's own fallback above) still produces a
// best-effort link rather than throwing, since a merchant clicking through
// on a slightly malformed saved number is a better outcome than a crash.
export function waLink(phone: string): string {
  return `https://wa.me/${normalizePhone(phone).replace(/^\+/, "")}`;
}

// Mirrors backend/src/common/normalize.ts's normalizeWebsiteUrl by hand.
export function normalizeWebsiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Mirrors backend/src/common/normalize.ts's normalizeTrn by hand.
export function normalizeTrn(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

export interface PasswordRequirement {
  label: string;
  met: boolean;
}

// Backs both validatePassword() and PasswordRequirements.tsx's live
// checklist — one source of truth for the four conditions instead of the
// checklist silently drifting from what the regex actually enforces.
export function passwordRequirements(value: string): PasswordRequirement[] {
  return [
    { label: "At least 8 characters", met: value.length >= 8 },
    { label: "1 uppercase letter (A–Z)", met: /[A-Z]/.test(value) },
    { label: "1 number (0–9)", met: /[0-9]/.test(value) },
    { label: "1 special character (@#$%^&*!?)", met: /[@#$%^&*!?]/.test(value) },
  ];
}

export function validatePassword(value: string): ValidationResult {
  if (!value) return { valid: false, message: "Password is required" };
  if (!PASSWORD_REGEX.test(value)) {
    return {
      valid: false,
      message: "Password must be 8+ characters with an uppercase letter, a number, and a special character",
    };
  }
  return { valid: true };
}

// TRN is optional — blank is valid, only a malformed non-blank value errors.
export function validateTrn(value: string): ValidationResult {
  if (!value.trim()) return { valid: true };
  if (!TRN_REGEX.test(value.trim())) {
    return { valid: false, message: "Enter a valid TRN" };
  }
  return { valid: true };
}

// Website URL is optional — blank is valid, only a malformed non-blank value errors.
export function validateUrl(value: string): ValidationResult {
  if (!value.trim()) return { valid: true };
  if (!URL_REGEX.test(value.trim())) {
    return { valid: false, message: "Enter a valid URL (e.g., https://example.com)" };
  }
  return { valid: true };
}

export function validateRequired(value: string, fieldLabel: string): ValidationResult {
  if (!value.trim()) return { valid: false, message: `${fieldLabel} is required` };
  return { valid: true };
}

// The editable part of the Account Setup wizard's subdomain picker
// (AccountSetupStepBusiness.tsx) — pre-filled from the business name via
// slugifySubdomain() below, but freely editable, so it needs its own
// validation independent of the business name field.
export function validateSubdomain(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, message: "Subdomain is required" };
  if (trimmed.length < 3 || trimmed.length > 63) {
    return { valid: false, message: "Subdomain must be 3-63 characters" };
  }
  if (!SUBDOMAIN_REGEX.test(trimmed)) {
    return { valid: false, message: "Only lowercase letters, numbers, and hyphens" };
  }
  if (trimmed.startsWith("-") || trimmed.endsWith("-")) {
    return { valid: false, message: "Can't start or end with a hyphen" };
  }
  if (RESERVED_SUBDOMAINS.includes(trimmed)) {
    return { valid: false, message: "This subdomain is reserved" };
  }
  return { valid: true };
}

// Custom storefront domain — required (unlike validateUrl above, this field
// is only ever validated while the "Custom domain" tab is selected, so an
// empty value is always a real error, never "optional and blank").
export function validateCustomDomain(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, message: "Domain is required" };
  if (!CUSTOM_DOMAIN_REGEX.test(trimmed) || trimmed.length > 253) {
    return { valid: false, message: "Enter a valid domain (e.g. shop.example.com)" };
  }
  if (isPlatformOwnedHost(trimmed)) {
    return { valid: false, message: "Enter a domain you own, not a requital.io address." };
  }
  return { valid: true };
}

// Mirrors backend/src/common/normalize.ts's normalizeCustomDomain by hand —
// strips a pasted protocol/trailing path so what's stored/validated is
// always a bare hostname.
export function normalizeCustomDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

// Auto-fills the subdomain picker from the business name (still freely
// editable afterward) — lowercase, non-alphanumerics collapsed to a single
// hyphen, leading/trailing hyphens trimmed, capped at 40 chars so it stays
// comfortably under the 63-char backend limit even after a user edits it.
export function slugifySubdomain(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
