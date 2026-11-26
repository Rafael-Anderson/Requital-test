import { describe, expect, it } from "vitest";
import {
  displayNumberMatches,
  sanitizeCredentialValue,
  whatsappCredentialProblems,
} from "./whatsapp-credentials";

describe("sanitizeCredentialValue", () => {
  it("strips bidi, zero-width, BOM, soft hyphen and surrounding spaces", () => {
    expect(sanitizeCredentialValue("  ‎123456789012345⁩﻿­  ")).toBe("123456789012345");
  });
  it("leaves a normal value unchanged", () => {
    expect(sanitizeCredentialValue("EAABsecret_99")).toBe("EAABsecret_99");
  });
});

describe("whatsappCredentialProblems", () => {
  it("accepts a digits-only id (after cleaning) and a token without spaces", () => {
    expect(whatsappCredentialProblems({ phoneNumberId: "123456789012345⁩", accessToken: "EAAB123" })).toEqual({});
  });
  it("names the field for a non-digit id and a token with spaces", () => {
    const p = whatsappCredentialProblems({ phoneNumberId: "+971 50 123", accessToken: "EAA B" });
    expect(p.phoneNumberId).toMatch(/Phone Number ID/);
    expect(p.accessToken).toMatch(/access token/);
  });
  it("requires both fields", () => {
    const p = whatsappCredentialProblems({ phoneNumberId: "", accessToken: "" });
    expect(Object.keys(p).sort()).toEqual(["accessToken", "phoneNumberId"]);
  });
});

describe("displayNumberMatches", () => {
  it("matches on digits, ignoring a local leading 0", () => {
    expect(displayNumberMatches("+971 50 123 4567", "+971", "0501234567")).toBe(true);
  });
  it("reports a different number", () => {
    expect(displayNumberMatches("+971 55 999 0000", "+971", "501234567")).toBe(false);
  });
  it("returns null when there is nothing to compare", () => {
    expect(displayNumberMatches(null, "+971", "501234567")).toBeNull();
    expect(displayNumberMatches("+971 50", "+971", "")).toBeNull();
  });
});
