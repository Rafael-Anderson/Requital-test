import { describe, expect, it } from "vitest";
import { buildSitemapXml } from "./sitemap";

describe("buildSitemapXml", () => {
  it("wraps each URL in a <url><loc> entry inside a valid urlset", () => {
    const xml = buildSitemapXml(["http://localhost:3002/acme", "http://localhost:3002/acme/products/rose"]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">");
    expect(xml).toContain("<url><loc>http://localhost:3002/acme</loc></url>");
    expect(xml).toContain("<url><loc>http://localhost:3002/acme/products/rose</loc></url>");
  });

  it("produces an empty (but valid) urlset for no URLs", () => {
    const xml = buildSitemapXml([]);
    expect(xml).toContain("<urlset");
    expect(xml).not.toContain("<url>");
  });
});
