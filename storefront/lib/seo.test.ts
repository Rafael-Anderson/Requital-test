import { describe, expect, it } from "vitest";
import { buildBioPageMetadata, buildBrandMetadata, buildProductMetadata, buildShopMetadata } from "./seo";
import type { BioPageConfig, Product, Shop } from "./types";

// Only the fields these functions actually read are filled in — the rest
// cast through `as Shop`/`as Product` rather than padding out every field
// on these large response types.
function shop(overrides: Partial<Shop>): Shop {
  return {
    name: "fallback-name",
    displayName: null,
    description: null,
    metaTitle: null,
    metaDescription: null,
    ogImage: null,
    ...overrides,
  } as Shop;
}

function product(overrides: Partial<Product>): Product {
  return {
    id: 1,
    slug: "widget",
    name: "Widget",
    thumbnail: "/uploads/products/widget.jpg",
    metaTitle: "Widget",
    metaDescription: null,
    ...overrides,
  } as Product;
}

describe("buildShopMetadata", () => {
  it("uses the explicit SEO title/description when set", () => {
    const result = buildShopMetadata(shop({ metaTitle: "Best Flowers", metaDescription: "Same-day delivery", displayName: "Acme Flowers" }));
    expect(result.title).toBe("Best Flowers");
    expect(result.description).toBe("Same-day delivery");
  });

  it("falls back to displayName, then name, when no SEO title is set", () => {
    expect(buildShopMetadata(shop({ displayName: "Acme Flowers" })).title).toBe("Acme Flowers");
    expect(buildShopMetadata(shop({ displayName: null })).title).toBe("fallback-name");
  });

  it("falls back to the shop's own description when no SEO description is set", () => {
    expect(buildShopMetadata(shop({ description: "A lovely flower shop." })).description).toBe(
      "A lovely flower shop.",
    );
  });

  it("omits openGraph.images when there is no OG image at all", () => {
    const result = buildShopMetadata(shop({ ogImage: null }));
    expect(result.openGraph?.images).toBeUndefined();
  });

  it("resolves a backend-relative OG image to an absolute URL", () => {
    const result = buildShopMetadata(shop({ ogImage: "/uploads/theme/banner.jpg" }));
    expect(result.openGraph?.images).toEqual([{ url: "http://localhost:3000/uploads/theme/banner.jpg" }]);
  });
});

describe("buildProductMetadata", () => {
  it("uses the product's already-fallback-resolved metaTitle/metaDescription as-is", () => {
    const result = buildProductMetadata(product({ metaTitle: "Rose Bouquet", metaDescription: "Fresh roses." }));
    expect(result.title).toBe("Rose Bouquet");
    expect(result.description).toBe("Fresh roses.");
  });

  it("always includes the product image in openGraph — required for WhatsApp/social link previews", () => {
    const result = buildProductMetadata(product({ thumbnail: "/uploads/products/rose.jpg" }));
    expect(result.openGraph?.images).toEqual([{ url: "http://localhost:3000/uploads/products/rose.jpg" }]);
  });

  it("leaves an already-absolute thumbnail untouched", () => {
    const result = buildProductMetadata(product({ thumbnail: "https://cdn.example.com/rose.jpg" }));
    expect(result.openGraph?.images).toEqual([{ url: "https://cdn.example.com/rose.jpg" }]);
  });
});

function bioPageConfig(overrides: Partial<BioPageConfig>): BioPageConfig {
  return { logoUrl: null, backgroundUrl: null, description: null, metaTitle: null, metaDescription: null, ...overrides };
}

describe("buildBrandMetadata", () => {
  it("composes the title and description from the brand + resolved shop name", () => {
    const result = buildBrandMetadata(shop({ displayName: "Acme Flowers" }), { name: "Rosewood" });
    expect(result.title).toBe("Rosewood | Acme Flowers");
    expect(result.description).toBe("Shop Rosewood products at Acme Flowers.");
  });

  it("falls back to shop.name when there is no displayName", () => {
    expect(buildBrandMetadata(shop({ displayName: null }), { name: "Rosewood" }).title).toBe("Rosewood | fallback-name");
  });

  it("uses the shop ogImage for the OG image", () => {
    const result = buildBrandMetadata(shop({ ogImage: "/uploads/theme/banner.jpg" }), { name: "Rosewood" });
    expect(result.openGraph?.images).toEqual([{ url: "http://localhost:3000/uploads/theme/banner.jpg" }]);
  });
});

describe("buildBioPageMetadata", () => {
  it("uses the bio-specific meta title/description when set", () => {
    const result = buildBioPageMetadata(
      shop({ metaTitle: "Shop SEO Title", displayName: "Acme Flowers" }),
      bioPageConfig({ metaTitle: "Bio Page Title", metaDescription: "All our links in one place" }),
    );
    expect(result.title).toBe("Bio Page Title");
    expect(result.description).toBe("All our links in one place");
  });

  it("falls back to the shop's general SEO meta when the bio-specific fields are empty", () => {
    const result = buildBioPageMetadata(
      shop({ metaTitle: "Shop SEO Title", metaDescription: "Shop SEO description" }),
      bioPageConfig({}),
    );
    expect(result.title).toBe("Shop SEO Title");
    expect(result.description).toBe("Shop SEO description");
  });

  it("falls further back to displayName/name/description when nothing SEO-specific is set at all", () => {
    expect(
      buildBioPageMetadata(shop({ displayName: "Acme Flowers" }), bioPageConfig({})).title,
    ).toBe("Acme Flowers");
    expect(
      buildBioPageMetadata(shop({ description: "A lovely flower shop." }), bioPageConfig({})).description,
    ).toBe("A lovely flower shop.");
  });
});
