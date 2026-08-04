// Pure field validators for the Account Setup wizard
// (components/AccountSetup.tsx / lib/useAccountSetupForm.ts). Kept
// framework-free and colocated with their regexes so lib/validators.test.ts
// can exercise them directly. backend/src/auth/dto/signup.dto.ts mirrors the
// email/phone/websiteUrl regexes by hand — there's no shared package between
// the two apps to import from (see CLAUDE.md's cross-app duplication note).

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PHONE_REGEX = /^(\+)?[0-9]{7,15}$/;
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[@#$%^&*!?]).{8,}$/;
// Lenient on purpose (UAE TRNs are usually a longer digit string) — this
// only checks the shape looks like "digits-digits-digits-digits", not a real
// checksum.
const TRN_REGEX = /^\d{2,4}-\d{2,5}-\d{2,4}-\d{2,4}$/;
const URL_REGEX = /^https?:\/\//i;

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
    return { valid: false, message: "Enter a valid phone number (7–15 digits, optional + prefix)" };
  }
  return { valid: true };
}

// On-blur transform for the phone field: strips spaces/dashes so the stored
// value is validation-friendly, without touching what the user sees while
// still typing.
export function stripPhoneFormatting(value: string): string {
  return value.replace(/[\s-]/g, "");
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
    return { valid: false, message: "Enter a valid TRN (e.g., 100-1234-567-890)" };
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
