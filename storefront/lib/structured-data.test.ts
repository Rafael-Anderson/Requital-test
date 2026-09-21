import { describe, expect, it } from "vitest";
import {
  breadcrumbJsonLd,
  organizationJsonLd,
  productJsonLd,
} from "./structured-data";
import type { Product, Shop } from "./types";

const shop = {
  name: "Arabian Petals",
  displayName: "Arabian Petals Florist",
  currency: "AED",
  logoUrl: "/uploads/logo.png",
  socialLinks: { instagram: "https://instagram.com/arabianpetals", whatsapp: "" },
} as unknown as Shop;

function product(over: Partial<Product> = {}): Product {
  return {
    id: 1,
    slug: "rose-bouquet",
    name: "Rose Bouquet",
    description: "<p>A <b>dozen</b> roses &amp; foliage.</p>",
    thumbnail: "/uploads/rose.jpg",
    images: [{ id: 1, url: "/uploads/rose-2.jpg", order: 0 }],
    price: "120.00",
    sku: "ROSE-1",
    status: "Available",
    stockQuantity: 5,
    brand: { id: 2, name: "Petal Co", logoUrl: null },
    collections: [],
    ...over,
  } as unknown as Product;
}

describe("productJsonLd", () => {
  const opts = { url: "https://shop.requital.io/products/rose-bouquet", price: 120 };

  it("emits a Product with a nested Offer", () => {
    const ld = productJsonLd(product(), shop, opts);
    expect(ld["@type"]).toBe("Product");
    expect(ld.name).toBe("Rose Bouquet");
    const offer = ld.offers as Record<string, unknown>;
    expect(offer["@type"]).toBe("Offer");
    expect(offer.price).toBe("120.00");
    expect(offer.priceCurrency).toBe("AED");
    expect(offer.url).toBe(opts.url);
  });

  // The price in the snippet has to be the price the shopper is charged. A
  // Product result advertising the undiscounted catalog price is the DSC-1
  // mis-pricing class aimed at search results.
  it("uses the charged price it is given, not the catalog price", () => {
    const ld = productJsonLd(product({ price: "120.00" }), shop, {
      ...opts,
      price: 90,
    });
    expect((ld.offers as { price: string }).price).toBe("90.00");
  });

  it("strips HTML out of the description", () => {
    const ld = productJsonLd(product(), shop, opts);
    expect(ld.description).toBe("A dozen roses & foliage.");
  });

  it("marks an unavailable or sold-out product OutOfStock", () => {
    expect(
      (productJsonLd(product({ status: "Draft" }), shop, opts).offers as {
        availability: string;
      }).availability,
    ).toBe("https://schema.org/OutOfStock");
    expect(
      (productJsonLd(product({ stockQuantity: 0 }), shop, opts).offers as {
        availability: string;
      }).availability,
    ).toBe("https://schema.org/OutOfStock");
  });

  // null means "no outlet context or untracked", which is not the same as
  // zero - treating it as out of stock would de-list most of the catalog.
  it("treats unknown stock as in stock", () => {
    expect(
      (productJsonLd(product({ stockQuantity: null }), shop, opts).offers as {
        availability: string;
      }).availability,
    ).toBe("https://schema.org/InStock");
  });

  it("never emits a rating or review, since no such feature exists", () => {
    const json = JSON.stringify(productJsonLd(product(), shop, opts));
    expect(json).not.toMatch(/aggregateRating/i);
    expect(json).not.toMatch(/review/i);
  });

  it("omits optional fields rather than emitting empty ones", () => {
    const ld = productJsonLd(
      product({ description: null, sku: "", brand: null }),
      shop,
      opts,
    );
    expect(ld).not.toHaveProperty("description");
    expect(ld).not.toHaveProperty("sku");
    expect(ld).not.toHaveProperty("brand");
  });

  it("de-duplicates images when the thumbnail is also in the gallery", () => {
    const ld = productJsonLd(
      product({ images: [{ id: 1, url: "/uploads/rose.jpg", order: 0 }] } as Partial<Product>),
      shop,
      opts,
    );
    expect(ld.image).toHaveLength(1);
  });
});

describe("organizationJsonLd", () => {
  it("uses the display name and the shop logo", () => {
    const ld = organizationJsonLd(shop, { url: "https://shop.requital.io" });
    expect(ld["@type"]).toBe("Organization");
    expect(ld.name).toBe("Arabian Petals Florist");
    expect(ld.url).toBe("https://shop.requital.io");
    expect(ld.logo).toContain("/uploads/logo.png");
  });

  it("lists only real social URLs in sameAs", () => {
    const ld = organizationJsonLd(shop, { url: "https://shop.requital.io" });
    expect(ld.sameAs).toEqual(["https://instagram.com/arabianpetals"]);
  });

  it("omits sameAs entirely when no social link is set", () => {
    const ld = organizationJsonLd(
      { ...shop, socialLinks: null } as unknown as Shop,
      { url: "https://shop.requital.io" },
    );
    expect(ld).not.toHaveProperty("sameAs");
  });

  it("falls back to the legal name when there is no display name", () => {
    const ld = organizationJsonLd(
      { ...shop, displayName: null } as unknown as Shop,
      { url: "https://shop.requital.io" },
    );
    expect(ld.name).toBe("Arabian Petals");
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers positions from 1 in order", () => {
    const ld = breadcrumbJsonLd([
      { name: "Home", url: "https://s.test/" },
      { name: "Flowers", url: "https://s.test/collections/flowers" },
      { name: "Rose Bouquet", url: "https://s.test/products/rose-bouquet" },
    ]);
    const items = ld.itemListElement as { position: number; name: string }[];
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items[2].name).toBe("Rose Bouquet");
  });
});
