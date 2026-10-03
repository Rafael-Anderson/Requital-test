import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// A dev or build-time request to Google Fonts made the admin dev server answer 500 on a CI runner
// (next/font/google "queries have exactly one entry"), so the e2e job failed before any test ran.
describe("admin root layout fonts", () => {
  const src = readFileSync(join(__dirname, "layout.tsx"), "utf-8");
  it("does not use next/font/google", () => {
    expect(src).not.toMatch(/from\s+"next\/font\/google"/);
  });
  it("self-hosts Inter and Geist Mono from app/fonts", () => {
    expect(src).toContain("./fonts/Inter-latin-variable.woff2");
    expect(src).toContain("./fonts/GeistMono-latin-variable.woff2");
  });
});
