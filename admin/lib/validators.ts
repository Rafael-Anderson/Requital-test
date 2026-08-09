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
