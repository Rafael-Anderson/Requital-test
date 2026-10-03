import { sanitizeHtml, sanitizeStyleAttribute } from './sanitize-html';

const clean = (html: string) => sanitizeHtml(html).html;

describe('sanitizeHtml: keeps what a product description needs', () => {
  it('passes the allowed formatting tags through', () => {
    const html =
      '<h2>Title</h2><p>Hello <strong>bold</strong> and <em>em</em><br>next</p><ul><li>a</li><li>b</li></ul>';
    expect(clean(html)).toBe(
      '<h2>Title</h2><p>Hello <strong>bold</strong> and <em>em</em><br>next</p><ul><li>a</li><li>b</li></ul>',
    );
  });

  it('keeps a safe link and the allowlisted style properties only', () => {
    expect(
      clean(
        '<a href="https://example.com/x?a=1&amp;b=2" target="_blank" onclick="x()">go</a>',
      ),
    ).toBe('<a href="https://example.com/x?a=1&amp;b=2">go</a>');
    expect(
      clean(
        '<span style="color: #ff0000; position: fixed; font-size: 14px">x</span>',
      ),
    ).toBe('<span style="color: #ff0000; font-size: 14px">x</span>');
    expect(clean('<p style="position:fixed">x</p>')).toBe('<p>x</p>');
  });

  it('keeps the text of an unknown tag and reports the tag that was dropped', () => {
    const result = sanitizeHtml(
      '<table><tr><td>cell</td></tr></table><img src="x.png"><blockquote>q</blockquote>',
    );
    expect(result.html).toBe('cellq');
    expect(result.removedTags).toEqual([
      'blockquote',
      'img',
      'table',
      'td',
      'tr',
    ]);
  });

  it('leaves plain text and entities alone, escaping only angle brackets', () => {
    expect(clean('Tom &amp; Jerry &lt;3 5 > 3 and 2 < 3')).toBe(
      'Tom &amp; Jerry &lt;3 5 &gt; 3 and 2 &lt; 3',
    );
  });

  it('handles an empty string', () => {
    expect(clean('')).toBe('');
  });
});

describe('sanitizeHtml: stored XSS vectors', () => {
  const vectors: [string, string][] = [
    ['script tag', '<script>alert(1)</script>'],
    ['script with attributes', '<script src="https://evil.com/x.js"></script>'],
    ['mixed-case script', '<ScRiPt>alert(1)</sCrIpT>'],
    ['unterminated script', '<p>hi</p><script>alert(1)'],
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['img onerror quoted', '<img src="x" onerror="alert(1)">'],
    ['svg onload', '<svg onload=alert(1)>'],
    ['svg script', '<svg><script>alert(1)</script></svg>'],
    [
      'svg with style img',
      '<svg><style><img src=x onerror=alert(1)></style></svg>',
    ],
    ['iframe', '<iframe src="javascript:alert(1)"></iframe>'],
    ['iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
    ['object', '<object data="javascript:alert(1)"></object>'],
    ['embed', '<embed src="javascript:alert(1)">'],
    ['body onload', '<body onload=alert(1)>'],
    ['input autofocus', '<input autofocus onfocus=alert(1)>'],
    ['details ontoggle', '<details open ontoggle=alert(1)>'],
    ['video onerror', '<video><source onerror=alert(1)></video>'],
    ['math', '<math><mi xlink:href="javascript:alert(1)">x</mi></math>'],
    ['style tag', '<style>@import "javascript:alert(1)"</style>'],
    ['link tag', '<link rel=stylesheet href=javascript:alert(1)>'],
    [
      'meta refresh',
      '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
    ],
    ['base tag', '<base href="javascript:alert(1)//">'],
    [
      'form action',
      '<form action="javascript:alert(1)"><input type=submit></form>',
    ],
    [
      'button formaction',
      '<button formaction="javascript:alert(1)">x</button>',
    ],
    ['javascript href', '<a href="javascript:alert(1)">x</a>'],
    ['mixed-case javascript href', '<a href="JaVaScRiPt:alert(1)">x</a>'],
    ['tab inside scheme', '<a href="java\tscript:alert(1)">x</a>'],
    ['newline inside scheme', '<a href="java\nscript:alert(1)">x</a>'],
    ['entity-encoded scheme', '<a href="&#106;avascript:alert(1)">x</a>'],
    ['hex entity scheme', '<a href="&#x6A;avascript:alert(1)">x</a>'],
    ['named entity colon', '<a href="javascript&colon;alert(1)">x</a>'],
    ['entity tab in scheme', '<a href="java&Tab;script:alert(1)">x</a>'],
    ['leading space scheme', '<a href="  javascript:alert(1)">x</a>'],
    ['control char scheme', '<a href="\u0001javascript:alert(1)">x</a>'],
    ['data href', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
    ['vbscript href', '<a href="vbscript:msgbox(1)">x</a>'],
    ['protocol-relative href', '<a href="//evil.com/x">x</a>'],
    ['backslash host href', '<a href="\\\\evil.com\\x">x</a>'],
    ['unquoted href', '<a href=javascript:alert(1)>x</a>'],
    ['backtick quoted', '<a href=`javascript:alert(1)`>x</a>'],
    ['slash instead of space', '<a/href="javascript:alert(1)">x</a>'],
    ['onclick on a', '<a href="/ok" onclick="alert(1)">x</a>'],
    ['onmouseover on p', '<p onmouseover="alert(1)">x</p>'],
    ['style expression', '<p style="width: expression(alert(1))">x</p>'],
    ['style url', '<p style="background: url(javascript:alert(1))">x</p>'],
    ['style color url', '<p style="color: url(x)">x</p>'],
    ['style import', '<p style="color: red; @import url(x)">x</p>'],
    ['style entity', '<p style="col&#111;r: re&#100;; behavior: url(x)">x</p>'],
    ['broken tag', '<<script>alert(1)//<</script>'],
    ['nested angle', '<scr<script>ipt>alert(1)</scr</script>ipt>'],
    ['null byte', '<scr\u0000ipt>alert(1)</script>'],
    ['comment trick', '<!--><script>alert(1)</script>-->'],
    ['comment end trick', '<!-- --!><script>alert(1)</script>'],
    ['cdata', '<![CDATA[<script>alert(1)</script>]]>'],
    [
      'processing instruction',
      '<?xml version="1.0"?><script>alert(1)</script>',
    ],
    [
      'noscript attribute breakout',
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    ],
    ['textarea breakout', '<textarea></textarea><script>alert(1)</script>'],
    ['title breakout', '<title></title><script>alert(1)</script>'],
    ['xmp', '<xmp><script>alert(1)</script></xmp>'],
    ['template', '<template><script>alert(1)</script></template>'],
    [
      'attribute with angle brackets',
      '<p title="<script>alert(1)</script>">x</p>',
    ],
    ['unterminated attribute', '<p title="x><script>alert(1)</script>'],
    ['unterminated tag', '<p <script>alert(1)</script>'],
  ];

  // The invariant that makes the sanitiser safe: after removing every tag the
  // sanitiser itself writes (allowlisted name, at most a validated href and a
  // validated style), no '<' may remain, i.e. nothing else is markup.
  const OWN_TAG =
    /<\/?(?:p|div|br|b|strong|i|em|u|s|h[1-6]|ul|ol|li|span)(?: style="[^"<>]*")?>|<a(?: href="[^"<>\s]*")?(?: style="[^"<>]*")?>|<\/a>/g;

  function assertInert(output: string) {
    const stripped = output.replace(OWN_TAG, '');
    expect(stripped).not.toContain('<');
    expect(stripped).not.toContain('>');
    for (const m of output.matchAll(/<a href="([^"]*)"/g)) {
      expect(m[1]).toMatch(/^(https?:|mailto:|tel:|[^:\\]*$)/i);
      expect(m[1].toLowerCase()).not.toMatch(/^[a-z]*script:|^data:|^\/\//);
    }
  }

  it.each(vectors)('neutralises: %s', (_name, input) => {
    const out = clean(input);
    assertInert(out);
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out.toLowerCase()).not.toContain('<img');
    expect(out.toLowerCase()).not.toContain('<svg');
    expect(out.toLowerCase()).not.toContain('<iframe');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('is idempotent: sanitising twice changes nothing', () => {
    for (const [, input] of vectors) {
      const once = clean(input);
      expect(clean(once)).toBe(once);
    }
  });

  it('survives a seeded fuzz of tag and attribute fragments', () => {
    const fragments = [
      '<',
      '>',
      '</',
      '/>',
      '<a href="',
      '<a href=',
      '"',
      "'",
      '=',
      ' ',
      '\n',
      '\t',
      'javascript:',
      'java\tscript:',
      '&#106;',
      '&colon;',
      'onerror=',
      'onclick=',
      'alert(1)',
      '<script>',
      '</script>',
      '<img ',
      'src=x ',
      '<svg>',
      '<style>',
      '</style>',
      '<p>',
      '</p>',
      '<div style="',
      'color: red;',
      'position: fixed',
      '<!--',
      '-->',
      '<![CDATA[',
      '<b>',
      '</b>',
      '<a>',
      '</a>',
      '<iframe ',
      'srcdoc=',
      'text',
    ];
    let seed = 1234567;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let n = 0; n < 3000; n += 1) {
      let input = '';
      const parts = 2 + Math.floor(next() * 14);
      for (let k = 0; k < parts; k += 1)
        input += fragments[Math.floor(next() * fragments.length)];
      const out = clean(input);
      assertInert(out);
      expect(clean(out)).toBe(out);
    }
  });
});

describe('sanitizeHtml: structure', () => {
  it('never lets imported HTML close an element of the surrounding page', () => {
    expect(clean('</div></div>text')).toBe('text');
    expect(clean('<p>a</p></p></div>b')).toBe('<p>a</p>b');
  });

  it('closes what it opened', () => {
    expect(clean('<div><p>open')).toBe('<div><p>open</p></div>');
  });

  it('closes intermediate tags when an outer one closes', () => {
    expect(clean('<div><p><b>x</div>y')).toBe('<div><p><b>x</b></p></div>y');
  });

  it('caps nesting depth', () => {
    const deep = '<div>'.repeat(500) + 'x';
    const out = clean(deep);
    expect((out.match(/<div>/g) ?? []).length).toBeLessThanOrEqual(100);
    expect((out.match(/<\/div>/g) ?? []).length).toBe(
      (out.match(/<div>/g) ?? []).length,
    );
  });

  it('strips control characters from text', () => {
    expect(clean('a\u0000b\u0007c\td')).toBe('abc\td');
  });
});

describe('sanitizeStyleAttribute (mirror of the storefront allowlist)', () => {
  it('keeps only color, font-size, font-family and text-align with valid values', () => {
    expect(
      sanitizeStyleAttribute(
        'color: red; text-align: center; margin: 10px; font-size: 12px',
      ),
    ).toBe('color: red; text-align: center; font-size: 12px');
    expect(sanitizeStyleAttribute('color: url(x)')).toBe('');
    expect(sanitizeStyleAttribute('font-family: "A", serif')).toBe(
      'font-family: "A", serif',
    );
  });
});
