import { describe, expect, it } from "vitest";
import { sanitizeDescriptionHtml, stripHtmlToText } from "./sanitize-html";

describe("sanitizeDescriptionHtml", () => {
  it("keeps tags the RichTextEditor toolbar can actually produce", () => {
    const html = "<p>Hello <b>world</b></p><h2>Details</h2><ul><li>One</li></ul><a href=\"https://example.com\">link</a>";
    expect(sanitizeDescriptionHtml(html)).toBe(html);
  });

  it("strips a script tag — the exact stored-XSS shape this exists to stop", () => {
    const out = sanitizeDescriptionHtml('<p>Hi</p><script>alert(1)</script>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
  });

  it("strips an inline event-handler attribute", () => {
    const out = sanitizeDescriptionHtml('<p onclick="alert(1)">Click</p>');
    expect(out).not.toContain("onclick");
  });

  it("strips a disallowed tag (img) but keeps its safe text content if any", () => {
    const out = sanitizeDescriptionHtml('<img src="x" onerror="alert(1)" /><p>Safe</p>');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("onerror");
    expect(out).toContain("Safe");
  });

  it("drops attributes outside the allowlist (e.g. style) even on an allowed tag", () => {
    const out = sanitizeDescriptionHtml('<p style="background:url(javascript:alert(1))">Text</p>');
    expect(out).not.toContain("style");
  });
});

describe("stripHtmlToText", () => {
  it("removes tags and collapses block boundaries into spaces", () => {
    expect(stripHtmlToText("<p>Hand-tied <b>daily</b>.</p><h2>Includes</h2><ul><li>Vase</li></ul>")).toBe(
      "Hand-tied daily. Includes Vase",
    );
  });

  it("returns plain text unchanged", () => {
    expect(stripHtmlToText("Just plain text")).toBe("Just plain text");
  });
});
