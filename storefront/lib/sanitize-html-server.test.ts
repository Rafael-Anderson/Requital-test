import { describe, expect, it } from "vitest";
import { sanitizeHtmlOnServer } from "./sanitize-html-server";
import { sanitizeDescriptionHtml } from "./sanitize-html";

const ALLOWED = new Set(["P", "DIV", "BR", "B", "STRONG", "I", "EM", "U", "S", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "A", "SPAN"]);

// What a browser makes of the output: the markup is judged by its DOM, not its text.
function parse(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

function assertSafe(html: string) {
  const root = parse(sanitizeHtmlOnServer(html));
  for (const el of Array.from(root.querySelectorAll("*"))) {
    expect(ALLOWED.has(el.tagName), `tag ${el.tagName} in ${JSON.stringify(html)}`).toBe(true);
    for (const attr of Array.from(el.attributes)) {
      expect(["href", "style"], `attr ${attr.name} in ${JSON.stringify(html)}`).toContain(attr.name);
      if (attr.name === "href") {
        // http(s)/mailto/tel, or a relative URL: no scheme (a colon before the first / ? #) and no protocol-relative start.
        const ok = /^(https?:|mailto:|tel:)/i.test(attr.value) || (!/^[^/?#]*:/.test(attr.value) && !/^[\\/]{2}/.test(attr.value));
        expect(ok, `href ${attr.value}`).toBe(true);
      }
      if (attr.name === "style") expect(attr.value).not.toMatch(/url\(|expression|javascript|@import|position|background/i);
    }
  }
}

const HOSTILE = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "<svg onload=alert(1)><circle/></svg>",
  '<a href="javascript:alert(1)">x</a>',
  '<a href="  java\tscript:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<a href="//evil.example/x">x</a>',
  '<p style="position:fixed;top:0;background:url(javascript:alert(1))">x</p>',
  '<span style="color:red;expression(alert(1))">x</span>',
  '<span style="font-family:a;}</style><script>alert(1)</script>">x</span>',
  '<div onclick="alert(1)">x</div>',
  "<iframe src=//evil></iframe>",
  "<style>body{display:none}</style>x",
  "<p><b>unclosed",
  "</div></div></main><h1>escape attempt",
  "<<script>script>alert(1)<</script>/script>",
  "<a href=\"x\" href=\"javascript:alert(1)\">x</a>",
  "<math><mi xlink:href=javascript:alert(1)>x</mi></math>",
  "<form action=//evil><button>x</button></form>",
  "<!--<script>alert(1)</script>-->x",
  "<p/onclick=alert(1)>x</p>",
  "<noscript><p title=\"</noscript><img src=x onerror=alert(1)>\"></noscript>",
];

describe("sanitizeHtmlOnServer", () => {
  it.each(HOSTILE)("emits only allowlisted tags and attributes for %s", (html) => {
    assertSafe(html);
  });

  it("survives random tag soup without ever emitting anything outside the allowlist", () => {
    const pieces = ["<", ">", "/", "=", '"', "'", "p", "a", "script", "img", "onerror", "href", "javascript:", "style", " ", "x", "&lt;", "&#60;", "<p>", "</p>", "<a href=", "<b ", "alert(1)"];
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let n = 0; n < 800; n++) {
      let s = "";
      for (let k = 0; k < 12; k++) s += pieces[Math.floor(rand() * pieces.length)];
      assertSafe(s);
    }
  }, 60_000);

  it("keeps what the editors produce", () => {
    const out = sanitizeHtmlOnServer('<h2>Title</h2><p style="color:#112233; text-align:center">Hi <b>there</b> <a href="https://x.test/a?b=1&c=2">link</a></p><ul><li>one</li></ul>');
    expect(out).toContain("<h2>Title</h2>");
    expect(out).toContain('style="color: #112233; text-align: center"');
    expect(out).toContain('<a href="https://x.test/a?b=1&amp;c=2">link</a>');
    expect(out).toContain("<ul><li>one</li></ul>");
  });

  it("keeps the words after a stray less-than", () => {
    expect(sanitizeDescriptionHtml("Prices <from AED 20")).toContain("from AED 20");
    expect(sanitizeHtmlOnServer("a < b and 1<2")).toContain("a &lt; b and 1&lt;2");
  });

  it("closes what it opened and never closes what it did not", () => {
    expect(sanitizeHtmlOnServer("<p><b>x")).toBe("<p><b>x</b></p>");
    expect(sanitizeHtmlOnServer("x</div></p>")).toBe("x");
  });

  it("agrees with the browser sanitiser on ordinary content (same DOM)", () => {
    const samples = ["<p>Plain</p>", "<h1>A</h1><h3>B</h3>", "<p><strong>b</strong> and <em>i</em></p>", '<p><a href="https://example.com">e</a></p>', "<ul><li>a</li><li>b</li></ul>"];
    for (const s of samples) {
      expect(parse(sanitizeHtmlOnServer(s)).innerHTML).toBe(parse(sanitizeDescriptionHtml(s)).innerHTML);
    }
  });
});
