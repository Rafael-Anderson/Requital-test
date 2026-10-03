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
  // NIST-style: length only, NO composition rules, so all-lowercase, digits-only
  // and passphrases are all fine client-side (the API rejects common/breached).
  const valid = [
    "correct horse battery staple",
    "alllowercaseletters",
    "12345678",
    "Aa1!aaaa",
    "é".repeat(36),
    "😀".repeat(8),
  ];
  const invalid = ["", "short1!", "1234567", "x".repeat(73), "🔐".repeat(25)];

  it.each(valid)("accepts %s", (password) => {
    expect(validatePassword(password)).toEqual({ valid: true });
  });

  it.each(invalid)("rejects %s", (password) => {
    const result = validatePassword(password);
    expect(result.valid).toBe(false);
    expect(result.message).toBeTruthy();
  });

  it("counts BYTES against the 72 limit, not characters", () => {
    expect(validatePassword("é".repeat(37)).valid).toBe(false);
    expect(validatePassword("é".repeat(37)).message).toMatch(/72 bytes/);
  });

  it("rejects a password equal to the email, its local part, the name or the shop name", () => {
    const identity = { email: "Zed.Admin@Example.com", name: "Zed Admin", shopName: "Zed Flowers" };
    for (const pw of ["zed.admin@example.com", "zed.admin", "Zed Admin", "zedflowers"]) {
      expect(validatePassword(pw, identity).valid).toBe(false);
    }
    expect(validatePassword("zed.admin-with-more-words", identity).valid).toBe(true);
  });
});

describe("passwordRequirements", () => {
  it("reports the length rule unmet and the byte cap met for an empty password", () => {
    const [len, max] = passwordRequirements("");
    expect(len.met).toBe(false);
    expect(max.met).toBe(true);
  });

  it("reports all met for a reasonable password", () => {
    expect(passwordRequirements("correct horse battery").every((r) => r.met)).toBe(true);
  });

  it("flags too short and too many bytes independently", () => {
    expect(passwordRequirements("abc").find((r) => r.label.startsWith("At least"))?.met).toBe(false);
    expect(passwordRequirements("🔐".repeat(25)).find((r) => r.label.startsWith("At most"))?.met).toBe(false);
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
  const invalid = [
    "example",
    "http://example.com",
    "example.com/path",
    "not a domain",
    "-example.com",
    "requital.io", // the platform apex
    "evil.requital.io", // any *.requital.io host
    "www.requital.io",
    "api.requital.io",
    "admin", // bare reserved label
  ];

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
