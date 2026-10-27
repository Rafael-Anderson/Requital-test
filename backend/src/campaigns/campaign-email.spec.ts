import {
  htmlToText,
  renderCampaignEmail,
  unsubscribeHeaders,
} from './campaign-email';
import { safeHeaders } from '../email/providers/resend-email.provider';

describe('campaign email rendering', () => {
  it('always carries the shop identity and the unsubscribe link, escaped', () => {
    const { html, text } = renderCampaignEmail({
      shopName: 'Rose <b>& Co</b>',
      address: 'Dubai, UAE',
      contactEmail: 'hi@rose.test',
      bodyHtml: '<p>Hello</p>',
      unsubscribeUrl: 'https://rose.requital.io/unsubscribe?token=abc',
    });
    expect(html).toContain('Rose &lt;b&gt;&amp; Co&lt;/b&gt;');
    expect(html).not.toContain('<b>& Co');
    expect(html).toContain(
      'href="https://rose.requital.io/unsubscribe?token=abc"',
    );
    expect(html).toContain('Dubai, UAE');
    expect(text).toContain(
      'Unsubscribe: https://rose.requital.io/unsubscribe?token=abc',
    );
    expect(text).toContain('Hello');
  });

  it('turns sanitised html into readable text', () => {
    expect(
      htmlToText(
        '<p>A &amp; B</p><p>See <a href="https://x.test/?a=1&amp;b=2">here</a></p>',
      ),
    ).toBe('A & B\n\nSee here (https://x.test/?a=1&b=2)');
  });

  it('builds the RFC 8058 one-click pair and strips anything that could end a header', () => {
    const h = unsubscribeHeaders(
      'https://x.test/a?token=1\r\nBcc: evil@x.test>',
    );
    expect(h['List-Unsubscribe']).toBe(
      '<https://x.test/a?token=1Bcc:evil@x.test>',
    );
    expect(h['List-Unsubscribe']).not.toMatch(/[\r\n]/);
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('provider header allowlist drops bad names and control characters', () => {
    expect(
      safeHeaders({
        'List-Unsubscribe': '<https://x.test>\r\nBcc: a@b.c',
        'Bad Name': 'x',
        'X:Evil': 'y',
      }),
    ).toEqual({ 'List-Unsubscribe': '<https://x.test> Bcc: a@b.c' });
    expect(safeHeaders(undefined)).toBeUndefined();
    expect(safeHeaders({ 'a b': 'x' })).toBeUndefined();
  });
});
