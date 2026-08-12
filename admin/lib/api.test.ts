import { describe, expect, it } from "vitest";
import { storefrontUrlFor } from "./api";

// The merchant-facing "your store's public address" — shown on Business
// Information's "Your store is live at", the outlet QR code, and TopBar's
// "View store" link. Was hardcoded to the old bare-path shape
// ({STOREFRONT_URL}/{subdomain}) predating per-shop domains — see CLAUDE.md's
// "Domains" section for the shape this must now match.
describe("storefrontUrlFor", () => {
  it("resolves to {subdomain}.requital.io for a shop on the default subdomain", () => {
    expect(
      storefrontUrlFor({ subdomain: "acme", domainType: "subdomain", customDomain: null }),
    ).toBe("https://acme.requital.io");
  });

  it("resolves to the connected custom domain when domainType is custom", () => {
    expect(
      storefrontUrlFor({
        subdomain: "acme",
        domainType: "custom",
        customDomain: "shop.acme.com",
      }),
    ).toBe("https://shop.acme.com");
  });

  it("falls back to the subdomain shape if domainType is custom but customDomain is somehow missing", () => {
    expect(
      storefrontUrlFor({ subdomain: "acme", domainType: "custom", customDomain: null }),
    ).toBe("https://acme.requital.io");
  });

  it("never returns the old bare-path shape", () => {
    const url = storefrontUrlFor({ subdomain: "acme", domainType: "subdomain", customDomain: null });
    expect(url).not.toMatch(/requital\.io\/acme$/);
  });
});
