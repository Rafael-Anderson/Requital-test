import { describe, expect, it } from "vitest";
import { resolveInternalApiOrigin } from "./api-origin";

const PUBLIC = "https://api.requital.io";

describe("resolveInternalApiOrigin", () => {
  it("falls back to the public origin when unset or blank (CI, dev, e2e)", () => {
    expect(resolveInternalApiOrigin(undefined, PUBLIC)).toBe(PUBLIC);
    expect(resolveInternalApiOrigin("", PUBLIC)).toBe(PUBLIC);
    expect(resolveInternalApiOrigin("   ", PUBLIC)).toBe(PUBLIC);
  });

  it("uses the internal origin when set, not the public one", () => {
    expect(resolveInternalApiOrigin("http://127.0.0.1:3000", PUBLIC)).toBe(
      "http://127.0.0.1:3000",
    );
    expect(resolveInternalApiOrigin(" http://127.0.0.1:3000/ ", PUBLIC)).toBe(
      "http://127.0.0.1:3000",
    );
  });

  it.each([
    "127.0.0.1:3000",
    "localhost",
    "ftp://127.0.0.1:3000",
    "http://127.0.0.1:3000/api",
    "http://user:pw@127.0.0.1:3000",
    "http://127.0.0.1:3000?x=1",
    "http://127.0.0.1:3000#x",
  ])("refuses %s instead of silently misrouting", (value) => {
    expect(() => resolveInternalApiOrigin(value, PUBLIC)).toThrow(
      /INTERNAL_API_URL/,
    );
  });
});
