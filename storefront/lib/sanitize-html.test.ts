import { describe, expect, it } from "vitest";
import { sanitizeDescriptionHtml, sanitizeStyleAttribute, stripHtmlToText } from "./sanitize-html";

describe("sanitizeDescriptionHtml", () => {
  it("keeps tags the rich-text editor can actually produce", () => {
    const html =
      '<p>Hello <b>world</b></p><h2>Details</h2><ul><li>One</li></ul><a href="https://example.com">link</a>';
    expect(sanitizeDescriptionHtml(html)).toBe(html);
  });

  it("keeps the extended tag set (h1/h3-h6, s)", () => {
    const html = "<h1>Big</h1><h3>Small</h3><p><s>struck</s></p>";
    expect(sanitizeDescriptionHtml(html)).toBe(html);
  });

  it("strips a script tag — the exact stored-XSS shape this exists to stop", () => {
    const out = sanitizeDescriptionHtml("<p>Hi</p><script>alert(1)</script>");
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
});

describe("sanitizeDescriptionHtml — inline style allowlist (#15/#16)", () => {
  it("keeps a colour / font-size / font-family / text-align span+block from TipTap", () => {
    const out = sanitizeDescriptionHtml(
      '<p style="text-align: center"><span style="color: #dc2626; font-size: 20px; font-family: Georgia, serif">Big red</span></p>',
    );
    expect(out).toContain("color: #dc2626");
    expect(out).toContain("font-size: 20px");
    expect(out).toContain("font-family: Georgia, serif");
    expect(out).toContain("text-align: center");
  });

  it("drops a style attribute that has no allowlisted declaration", () => {
    const out = sanitizeDescriptionHtml('<p style="background:url(javascript:alert(1))">Text</p>');
    expect(out).not.toContain("style");
    expect(out).toContain("Text");
  });

  it("keeps the allowed props and drops the rest from a mixed style attribute", () => {
    const out = sanitizeDescriptionHtml(
      '<span style="color: red; position: fixed; top: 0; font-size: 14px">x</span>',
    );
    expect(out).toContain("color: red");
    expect(out).toContain("font-size: 14px");
    expect(out).not.toContain("position");
    expect(out).not.toContain("top");
  });
});

describe("sanitizeStyleAttribute — rejection cases (#15/#16 security commit)", () => {
  const rejected: [string, string | null][] = [
    ["position: fixed", "position"],
    ["display: none", "display"],
    ["background: red", "background"],
    ["margin: -9999px", "margin"],
    ["color: red; behavior: url(x.htc)", "behavior"],
    ["color: red; -moz-binding: url(x.xml)", "-moz-binding"],
    ["color: expression(alert(1))", "expression"],
    ["color: url(javascript:alert(1))", "url("],
    ["font-family: </style><script>alert(1)</script>", "script"],
    ["color: red /* } * { color:blue */", "/*"],
    ["@import 'evil.css'", "import"],
    ["font-size: 20px; color: rgb(1,2,3,4,5)", null], // malformed rgb → color dropped, font-size kept
  ];
  for (const [input, mustNotContain] of rejected) {
    it(`rejects "${input}"`, () => {
      const out = sanitizeStyleAttribute(input);
      if (mustNotContain) expect(out.toLowerCase()).not.toContain(mustNotContain.toLowerCase());
      expect(out).not.toMatch(/<|>|url\(|expression|javascript:|@import|\/\*/i);
    });
  }

  it("keeps a clean multi-prop declaration verbatim (normalised spacing)", () => {
    expect(sanitizeStyleAttribute("color:#fff;  font-size:16px ;text-align:LEFT")).toBe(
      "color: #fff; font-size: 16px; text-align: LEFT",
    );
  });

  it("returns '' for an all-disallowed attribute (caller then drops it)", () => {
    expect(sanitizeStyleAttribute("position:absolute;z-index:99")).toBe("");
  });
});

describe("stripHtmlToText", () => {
  it("removes tags and collapses block boundaries into spaces", () => {
    expect(
      stripHtmlToText("<p>Hand-tied <b>daily</b>.</p><h2>Includes</h2><ul><li>Vase</li></ul>"),
    ).toBe("Hand-tied daily. Includes Vase");
  });

  it("returns plain text unchanged", () => {
    expect(stripHtmlToText("Just plain text")).toBe("Just plain text");
  });
});
