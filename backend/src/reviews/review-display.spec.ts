import {
  publicReviewComment,
  publicReviewerName,
  REVIEW_COMMENT_MAX_CHARS,
} from './review-display';

describe('publicReviewerName', () => {
  it('shows the first name and last initial only', () => {
    expect(publicReviewerName('Reem Al Mansoori')).toBe('Reem M.');
    expect(publicReviewerName('  Daniel   Kim ')).toBe('Daniel K.');
  });
  it('shows a single name as is and never leaks a full name', () => {
    expect(publicReviewerName('Priya')).toBe('Priya');
    expect(publicReviewerName('Priya Sharma')).not.toContain('Sharma');
  });
  it('handles empty and non-latin names by code point', () => {
    expect(publicReviewerName('')).toBe('Customer');
    expect(publicReviewerName(null)).toBe('Customer');
    expect(publicReviewerName('ريم المنصوري')).toBe('ريم ا.');
    expect(publicReviewerName('Ann 😀smith')).toBe('Ann 😀.');
  });
});

describe('publicReviewComment', () => {
  it('keeps markup as inert text (escaping is the renderer job)', () => {
    expect(publicReviewComment('<img src=x onerror=alert(1)>')).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });
  it('drops control characters but keeps newlines', () => {
    expect(publicReviewComment('a\u0000b\u0007c\nd')).toBe('abc\nd');
  });
  it('caps the length with an ellipsis', () => {
    const out = publicReviewComment('x'.repeat(REVIEW_COMMENT_MAX_CHARS + 50));
    expect(Array.from(out)).toHaveLength(REVIEW_COMMENT_MAX_CHARS + 1);
    expect(out.endsWith('…')).toBe(true);
  });
});
