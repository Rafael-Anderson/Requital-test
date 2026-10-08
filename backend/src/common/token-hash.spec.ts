import { generateSurveyToken } from './token-hash';

describe('generateSurveyToken', () => {
  it('is 128 bits as 32 uppercase hex characters, and does not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const t = generateSurveyToken();
      expect(t).toMatch(/^[0-9A-F]{32}$/);
      seen.add(t);
    }
    expect(seen.size).toBe(2000);
  });
});
