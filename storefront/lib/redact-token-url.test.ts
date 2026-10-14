import { describe, expect, it } from "vitest";
import { carriesToken, redactTokenUrl } from "./redact-token-url";

const T32 = "A1B2C3D4E5F60718293A4B5C6D7E8F90";

describe("redactTokenUrl", () => {
  it("redacts the order confirmation path segment, in path and subdomain mode, absolute or not", () => {
    for (const [input, out] of [
      [`/rose/orders/${T32}`, "/rose/orders/[redacted]"],
      [`/orders/${T32}`, "/orders/[redacted]"],
      [`https://rose.requital.io/orders/${T32}`, "https://rose.requital.io/orders/[redacted]"],
      [`https://irmain.com/orders/${T32.toLowerCase()}?paid=1#x`, "https://irmain.com/orders/[redacted]?paid=1#x"],
      ["/rose/orders/a1b2c3d4e5", "/rose/orders/[redacted]"],
      ["/rose/orders/9001", "/rose/orders/[redacted]"],
    ]) {
      expect(redactTokenUrl(input)).toBe(out);
    }
  });

  it("redacts every ?token= / &token= shape", () => {
    for (const [input, out] of [
      [`/rose/orders/track?token=${T32}`, "/rose/orders/track?token=[redacted]"],
      [`/survey?token=${T32}`, "/survey?token=[redacted]"],
      ["/cart/recover?token=abc123", "/cart/recover?token=[redacted]"],
      ["/pay?token=abc123&x=1", "/pay?token=[redacted]&x=1"],
      ["/pay/success?x=1&token=abc123#frag", "/pay/success?x=1&token=[redacted]#frag"],
      ["/account/verify-email?token=abc", "/account/verify-email?token=[redacted]"],
      ["/account/reset-password?TOKEN=abc", "/account/reset-password?TOKEN=[redacted]"],
    ]) {
      expect(redactTokenUrl(input)).toBe(out);
    }
  });

  it("leaves everything else alone, including the static track page and account order ids' siblings", () => {
    for (const u of ["/rose", "/rose/products/red-roses", "/rose/orders/track", "/rose/orders/track?x=1", "/rose/orders", "/rose/collections/orders", "https://rose.requital.io/", "?utm_source=x", ""]) {
      expect(redactTokenUrl(u)).toBe(u);
    }
  });

  it("is idempotent and carriesToken agrees", () => {
    const once = redactTokenUrl(`/rose/orders/${T32}?token=${T32}`);
    expect(redactTokenUrl(once)).toBe(once);
    expect(once).not.toContain(T32);
    expect(carriesToken(`/rose/orders/${T32}`)).toBe(true);
    expect(carriesToken("/rose/orders/track")).toBe(false);
    expect(carriesToken(null)).toBe(false);
  });
});
