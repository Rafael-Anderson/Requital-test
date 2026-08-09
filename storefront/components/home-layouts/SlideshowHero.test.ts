import { describe, expect, it } from "vitest";
import { buildSlides } from "./SlideshowHero";
import type { Product } from "@/lib/types";

function product(overrides: Partial<Product>): Product {
  return { id: 1, slug: "widget", name: "Widget", thumbnail: "/uploads/products/widget.jpg", ...overrides } as Product;
}

describe("buildSlides", () => {
  it("uses real uploaded banners, in order, ignoring products entirely when any exist", () => {
    const slides = buildSlides(
      [
        { url: "/uploads/theme/banner1.jpg", linkUrl: "/templates/sale" },
        { url: "/uploads/theme/banner2.jpg", linkUrl: null },
      ],
      [product({ id: 1, name: "A" })],
    );
    expect(slides).toEqual([
      { image: "http://localhost:3000/uploads/theme/banner1.jpg", label: null, linkUrl: "/templates/sale" },
      { image: "http://localhost:3000/uploads/theme/banner2.jpg", label: null, linkUrl: null },
    ]);
  });

  it("falls back to product thumbnails when no banners have ever been uploaded", () => {
    const slides = buildSlides([], [product({ id: 1, name: "A" })]);
    expect(slides).toEqual([{ image: "/uploads/products/widget.jpg", label: "A", linkUrl: null }]);
  });

  it("caps the product fallback at 4 slides", () => {
    const products = Array.from({ length: 10 }, (_, i) => product({ id: i, name: `P${i}` }));
    const slides = buildSlides([], products);
    expect(slides).toHaveLength(4);
  });

  it("does not cap real banners at 4 — the product limit doesn't apply once banners exist", () => {
    const banners = Array.from({ length: 6 }, (_, i) => ({ url: `/uploads/theme/b${i}.jpg`, linkUrl: null }));
    const slides = buildSlides(banners, []);
    expect(slides).toHaveLength(6);
  });

  it("returns no slides at all when there are no banners and no products", () => {
    expect(buildSlides([], [])).toEqual([]);
  });
});
