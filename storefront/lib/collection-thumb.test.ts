import { describe, expect, it } from "vitest";
import { collectionCircleImage, collectionTileImage } from "./collection-thumb";

describe("collection thumbnails: Icon first", () => {
  it("a rectangular tile prefers the Icon and falls back to the banner", () => {
    expect(collectionTileImage({ icon: "/i.png", image: "/b.jpg" })).toBe("/i.png");
    expect(collectionTileImage({ icon: null, image: "/b.jpg" })).toBe("/b.jpg");
    expect(collectionTileImage({ image: "/b.jpg" })).toBe("/b.jpg");
    expect(collectionTileImage({ icon: "", image: "/b.jpg" })).toBe("/b.jpg");
    expect(collectionTileImage({ icon: null, image: null })).toBeNull();
    expect(collectionTileImage(null)).toBeNull();
  });

  it("a circle uses the Icon only: with no Icon it is the first-letter placeholder, never the banner", () => {
    expect(collectionCircleImage({ icon: "/i.png", image: "/b.jpg" })).toBe("/i.png");
    expect(collectionCircleImage({ icon: null, image: "/b.jpg" })).toBeNull();
    expect(collectionCircleImage({ image: "/b.jpg" })).toBeNull();
    expect(collectionCircleImage(undefined)).toBeNull();
  });
});
