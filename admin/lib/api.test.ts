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

  it("resolves to the connected custom domain only once it is verified", () => {
    expect(
      storefrontUrlFor({
        subdomain: "acme",
        domainType: "custom",
        customDomain: "shop.acme.com",
        customDomainStatus: "verified",
      }),
    ).toBe("https://shop.acme.com");
  });

  it.each(["pending", "verifying", "failed", null, undefined] as const)(
    "does not present an unverified claim (status %s) as the live store address",
    (customDomainStatus) => {
      expect(
        storefrontUrlFor({
          subdomain: "acme",
          domainType: "custom",
          customDomain: "shop.acme.com",
          customDomainStatus,
        }),
      ).toBe("https://acme.requital.io");
    },
  );

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
