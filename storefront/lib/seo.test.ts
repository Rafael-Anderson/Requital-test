import { describe, expect, it } from "vitest";
import {
  buildBioPageMetadata,
  buildBrandMetadata,
  buildCollectionMetadata,
  buildProductMetadata,
  buildShopMetadata,
  canonicalUrlFor,
} from "./seo";
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

// Canonical / Twitter / OG-price additions (Phase 1 SEO basics).
describe("canonicalUrlFor", () => {
  it("joins the resolved origin with a parameter-free path", () => {
    expect(
      canonicalUrlFor({ canonicalOrigin: "https://s.requital.io" }, "/products/widget"),
    ).toBe("https://s.requital.io/products/widget");
  });

  it("collapses the root path so the canonical has no trailing slash artefact", () => {
    expect(canonicalUrlFor({ canonicalOrigin: "https://s.requital.io" }, "/")).toBe(
      "https://s.requital.io",
    );
  });

  // Guessing an origin is worse than omitting the tag: a wrong canonical
  // actively points crawlers at a URL that may not serve this content.
  it("returns undefined rather than guessing when the origin is missing", () => {
    expect(canonicalUrlFor({ canonicalOrigin: null }, "/products/widget")).toBeUndefined();
  });
});

describe("buildProductMetadata canonical and price tags", () => {
  const withShop = shop({ canonicalOrigin: "https://s.requital.io", currency: "AED" } as Partial<Shop>);

  it("sets the canonical and mirrors it on og:url", () => {
    const meta = buildProductMetadata(product({ slug: "widget" }), withShop);
    expect(meta.alternates?.canonical).toBe("https://s.requital.io/products/widget");
    expect((meta.openGraph as { url?: string }).url).toBe(
      "https://s.requital.io/products/widget",
    );
  });

  it("emits the charged price, not the catalog price, when one is given", () => {
    const meta = buildProductMetadata(product({ price: "120.00" } as Partial<Product>), withShop, {
      price: 90,
    });
    expect(meta.other?.["product:price:amount"]).toBe("90.00");
    expect(meta.other?.["product:price:currency"]).toBe("AED");
  });

  it("adds a Twitter card sized to whether an image exists", () => {
    const card = (meta: ReturnType<typeof buildProductMetadata>) =>
      (meta.twitter as { card?: string } | null)?.card;
    expect(card(buildProductMetadata(product({}), withShop))).toBe(
      "summary_large_image",
    );
    expect(
      card(
        buildProductMetadata(
          product({ thumbnail: "" } as Partial<Product>),
          withShop,
        ),
      ),
    ).toBe("summary");
  });

  // The old one-argument call shape is what the PDP falls back to when the
  // shop cannot be resolved; it must still produce the title/description it
  // always did.
  it("still works with no shop, omitting only the canonical and price tags", () => {
    const meta = buildProductMetadata(product({}));
    expect(meta.title).toBe("Widget");
    expect(meta.alternates).toBeUndefined();
    expect(meta.other).toBeUndefined();
  });
});

describe("buildCollectionMetadata", () => {
  it("composes a per-collection title and canonical", () => {
    const meta = buildCollectionMetadata(
      shop({ name: "Petals", canonicalOrigin: "https://s.requital.io" } as Partial<Shop>),
      { name: "Roses", slug: "roses" },
    );
    expect(meta.title).toBe("Roses | Petals");
    expect(meta.alternates?.canonical).toBe("https://s.requital.io/collections/roses");
  });

  it("falls back to a composed description when the collection has none", () => {
    const meta = buildCollectionMetadata(
      shop({ name: "Petals" } as Partial<Shop>),
      { name: "Roses", slug: "roses" },
    );
    expect(meta.description).toBe("Shop Roses at Petals.");
  });
});
