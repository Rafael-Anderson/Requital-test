import { describe, expect, it } from "vitest";
import {
  normalizeCustomDomain,
  normalizePhone,
  normalizeTrn,
  normalizeWebsiteUrl,
  passwordRequirements,
  slugifySubdomain,
  stripPhoneFormatting,
  validateCustomDomain,
  validateEmail,
  validatePassword,
  validatePhone,
  validateRequired,
  validateSubdomain,
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

// validatePhone runs post-normalization in real usage (normalizePhone is
// called onBlur before validateField) — so it only needs to accept the
// canonical E.164 shape, not every raw format a user might type. Those raw
// formats are covered by normalizePhone's own tests below.
describe("validatePhone", () => {
  const valid = ["+971501234567", "+12345678", "+1234567890123"];
  const invalid = ["", "123456", "0501234567", "971501234567", "abcdefg", "+", "12-34-56-78", "123 456 7890", "++971501234567"];

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

describe("normalizePhone", () => {
  it("prefixes a local UAE number with a leading 0", () => {
    expect(normalizePhone("0501234567")).toBe("+971501234567");
  });

  it("prefixes a bare UAE number with the country code but no +", () => {
    expect(normalizePhone("971501234567")).toBe("+971501234567");
  });

  it("leaves an already-E.164 number unchanged", () => {
    expect(normalizePhone("+971501234567")).toBe("+971501234567");
  });

  it("strips spaces, hyphens, and parentheses before normalizing", () => {
    expect(normalizePhone("050 123 4567")).toBe("+971501234567");
    expect(normalizePhone("(050) 123-4567")).toBe("+971501234567");
  });

  it("returns the input unchanged when it can't be parsed", () => {
    expect(normalizePhone("not-a-phone")).toBe("not-a-phone");
    expect(normalizePhone("")).toBe("");
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

// validateTrn also runs post-normalization in real usage (normalizeTrn
// strips dashes/spaces onBlur before validateField runs).
describe("validateTrn", () => {
  it("is valid when blank (optional field)", () => {
    expect(validateTrn("")).toEqual({ valid: true });
  });

  const valid = ["12312312", "100123456789012"];
  const invalid = ["not-a-trn", "100-1234-567-890", "1234567"];

  it.each(valid)("accepts %s", (trn) => {
    expect(validateTrn(trn)).toEqual({ valid: true });
  });

  it.each(invalid)("rejects %s", (trn) => {
    const result = validateTrn(trn);
    expect(result.valid).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

describe("normalizeTrn", () => {
  it("strips dashes and spaces to digits-only", () => {
    expect(normalizeTrn("100-1234-567-890")).toBe("1001234567890");
    expect(normalizeTrn("100 1234 567 890")).toBe("1001234567890");
  });

  it("leaves an already digits-only TRN unchanged", () => {
    expect(normalizeTrn("123456789012345")).toBe("123456789012345");
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

describe("normalizeWebsiteUrl", () => {
  it("leaves an already-protocol-prefixed URL unchanged", () => {
    expect(normalizeWebsiteUrl("https://example.com")).toBe("https://example.com");
    expect(normalizeWebsiteUrl("http://example.com")).toBe("http://example.com");
  });

  it("prefixes a bare domain with https://", () => {
    expect(normalizeWebsiteUrl("example.com")).toBe("https://example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeWebsiteUrl("  example.com  ")).toBe("https://example.com");
  });
});

describe("validateSubdomain", () => {
  const valid = ["acme", "acme-shop", "shop123", "abc"];
  const invalid = [
    "",
    "  ",
    "ab", // too short
    "a".repeat(64), // too long
    "Acme", // uppercase
    "acme shop", // space
    "acme.shop", // dot
    "-acme", // leading hyphen
    "acme-", // trailing hyphen
    "api", // reserved
    "admin", // reserved
    "www", // reserved
  ];

  it.each(valid)("accepts %s", (subdomain) => {
    expect(validateSubdomain(subdomain)).toEqual({ valid: true });
  });

  it.each(invalid)("rejects %s", (subdomain) => {
    const result = validateSubdomain(subdomain);
    expect(result.valid).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

describe("validateCustomDomain", () => {
  it("is invalid when blank (required, unlike validateUrl)", () => {
    expect(validateCustomDomain("").valid).toBe(false);
  });

  const valid = ["example.com", "shop.example.com", "my-shop.example.co.uk"];
  const invalid = ["example", "http://example.com", "example.com/path", "not a domain", "-example.com"];

  it.each(valid)("accepts %s", (domain) => {
    expect(validateCustomDomain(domain)).toEqual({ valid: true });
  });

  it.each(invalid)("rejects %s", (domain) => {
    const result = validateCustomDomain(domain);
    expect(result.valid).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

describe("normalizeCustomDomain", () => {
  it("strips a protocol and trailing path/slash, and lowercases", () => {
    expect(normalizeCustomDomain("HTTPS://Shop.Example.com/")).toBe("shop.example.com");
    expect(normalizeCustomDomain("http://example.com/some/path")).toBe("example.com");
  });

  it("leaves an already-bare lowercase hostname unchanged", () => {
    expect(normalizeCustomDomain("example.com")).toBe("example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeCustomDomain("  example.com  ")).toBe("example.com");
  });
});

describe("slugifySubdomain", () => {
  it("lowercases and collapses non-alphanumerics into single hyphens", () => {
    expect(slugifySubdomain("Acme Flowers & Gifts!")).toBe("acme-flowers-gifts");
  });

  it("trims leading/trailing hyphens produced by leading/trailing punctuation", () => {
    expect(slugifySubdomain("  Acme  ")).toBe("acme");
  });

  it("caps the result at 40 characters", () => {
    const long = "a".repeat(60);
    expect(slugifySubdomain(long)).toHaveLength(40);
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
