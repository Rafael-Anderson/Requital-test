import { describe, expect, it } from "vitest";
import {
  passwordRequirements,
  stripPhoneFormatting,
  validateEmail,
  validatePassword,
  validatePhone,
  validateRequired,
  validateTrn,
  validateUrl,
} from "./validators";

describe("validateEmail", () => {
  const valid = [
    "name@example.com",
    "first.last@sub.example.co.uk",
    "a@b.io",
    "UPPER@EXAMPLE.COM",
    "with+tag@example.com",
    "under_score@example.com",
    "dashed-name@example-domain.com",
    "digits123@example123.com",
    "a.b.c@example.travel",
    "x@y.museum",
  ];
  const invalid = ["", "  ", "no-at-sign.com", "double@@example.com", "missing-domain@", "@missing-local.com", "no-tld@example", "spaces in@example.com", "name@example.c", "name@.com"];

  it.each(valid)("accepts %s", (email) => {
    expect(validateEmail(email)).toEqual({ valid: true });
  });

  it.each(invalid)("rejects %s", (email) => {
    const result = validateEmail(email);
    expect(result.valid).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

describe("validatePhone", () => {
  const valid = ["1234567", "123456789012345", "+971501234567", "+12345678", "0501234567", "971501234567", "1112223", "+1234567890123"];
  const invalid = ["", "123456", "1234567890123456", "abcdefg", "+", "12-34-56-78", "123 456 7890", "++971501234567"];

  it.each(valid)("accepts %s", (phone) => {
    expect(validatePhone(phone)).toEqual({ valid: true });
  });

  it.each(invalid)("rejects %s", (phone) => {
    const result = validatePhone(phone);
    expect(result.valid).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

describe("stripPhoneFormatting", () => {
  it("removes spaces and dashes but keeps digits and +", () => {
    expect(stripPhoneFormatting("+971 50-123-4567")).toBe("+971501234567");
  });

  it("leaves an already-clean number unchanged", () => {
    expect(stripPhoneFormatting("+971501234567")).toBe("+971501234567");
  });
});

describe("validatePassword", () => {
  const valid = [
    "Password1!",
    "Abcdefg1@",
    "MySecure#Pass9",
    "Str0ng*Pass",
    "Aa1!aaaa",
    "P@ssw0rd",
    "Zzzzzzz9$",
    "Valid1?Pass",
    // No lowercase requirement in the spec/regex — an all-uppercase
    // password satisfying the other three conditions is valid.
    "NOLOWERCASE1!",
  ];
  const invalid = [
    "",
    "short1!",
    "nouppercase1!",
    "NoNumber!",
    "NoSpecial123",
    "12345678",
    "Password",
    "!!!!!!!!",
  ];

  it.each(valid)("accepts %s", (password) => {
    expect(validatePassword(password)).toEqual({ valid: true });
  });

  it.each(invalid)("rejects %s", (password) => {
    const result = validatePassword(password);
    expect(result.valid).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

describe("passwordRequirements", () => {
  it("reports all four unmet for an empty password", () => {
    expect(passwordRequirements("").every((r) => !r.met)).toBe(true);
  });

  it("reports all four met for a fully valid password", () => {
    expect(passwordRequirements("Password1!").every((r) => r.met)).toBe(true);
  });

  it("reports exactly the length requirement unmet for a too-short password", () => {
    const reqs = passwordRequirements("Ab1!");
    const byLabel = Object.fromEntries(reqs.map((r) => [r.label, r.met]));
    expect(byLabel["At least 8 characters"]).toBe(false);
    expect(byLabel["1 uppercase letter (A–Z)"]).toBe(true);
    expect(byLabel["1 number (0–9)"]).toBe(true);
    expect(byLabel["1 special character (@#$%^&*!?)"]).toBe(true);
  });
});

describe("validateTrn", () => {
  it("is valid when blank (optional field)", () => {
    expect(validateTrn("")).toEqual({ valid: true });
  });

  const valid = ["100-1234-567-890", "12-123-12-12", "1000-12345-1234-1234"];
  const invalid = ["not-a-trn", "100 1234 567 890", "abc-1234-567-890", "100-1234-567"];

  it.each(valid)("accepts %s", (trn) => {
    expect(validateTrn(trn)).toEqual({ valid: true });
  });

  it.each(invalid)("rejects %s", (trn) => {
    const result = validateTrn(trn);
    expect(result.valid).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

describe("validateUrl", () => {
  it("is valid when blank (optional field)", () => {
    expect(validateUrl("")).toEqual({ valid: true });
  });

  const valid = ["https://example.com", "http://example.com", "https://sub.example.co.uk/path?query=1"];
  const invalid = ["example.com", "ftp://example.com", "www.example.com", "not a url"];

  it.each(valid)("accepts %s", (url) => {
    expect(validateUrl(url)).toEqual({ valid: true });
  });

  it.each(invalid)("rejects %s", (url) => {
    const result = validateUrl(url);
    expect(result.valid).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

describe("validateRequired", () => {
  it("rejects blank/whitespace-only values", () => {
    expect(validateRequired("", "Name").valid).toBe(false);
    expect(validateRequired("   ", "Name").valid).toBe(false);
  });

  it("accepts a non-blank value", () => {
    expect(validateRequired("Acme", "Name")).toEqual({ valid: true });
  });

  it("includes the field label in the error message", () => {
    expect(validateRequired("", "Business name").message).toContain("Business name");
  });
});
