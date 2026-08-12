import { describe, expect, it } from "vitest";
import { isTrustedAdminOrigin } from "./theme-preview-origin";

describe("isTrustedAdminOrigin", () => {
  it("trusts the dev admin origin", () => {
    expect(isTrustedAdminOrigin("http://localhost:3001")).toBe(true);
  });

  it("trusts the production admin origin", () => {
    expect(isTrustedAdminOrigin("https://admin.requital.io")).toBe(true);
  });

  it("rejects an untrusted origin", () => {
    expect(isTrustedAdminOrigin("https://evil.example.com")).toBe(false);
  });

  it("rejects a spoofed subdomain that merely contains the real domain", () => {
    expect(isTrustedAdminOrigin("https://admin.requital.io.evil.com")).toBe(false);
  });

  it("rejects the storefront's own origin", () => {
    expect(isTrustedAdminOrigin("https://requital.io")).toBe(false);
  });
});
