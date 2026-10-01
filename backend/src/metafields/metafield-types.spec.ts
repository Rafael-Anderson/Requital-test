import {
  MetafieldInvalid,
  normalizeValidationConfig,
  validateMetafieldValue,
} from './metafield-types';

const bad = (fn: () => unknown) => expect(fn).toThrow(MetafieldInvalid);

describe('normalizeValidationConfig', () => {
  it('requires options for selects and rejects duplicates / blanks / too many', () => {
    bad(() => normalizeValidationConfig('single_select', undefined));
    bad(() => normalizeValidationConfig('multi_select', { options: [] }));
    bad(() =>
      normalizeValidationConfig('single_select', { options: ['a', 'a'] }),
    );
    bad(() => normalizeValidationConfig('single_select', { options: [' '] }));
    bad(() =>
      normalizeValidationConfig('single_select', {
        options: Array.from({ length: 101 }, (_, i) => `o${i}`),
      }),
    );
    expect(
      normalizeValidationConfig('single_select', { options: ['S', 'M'] }),
    ).toEqual({ options: ['S', 'M'] });
  });

  it('rejects settings the type does not take, and inverted ranges', () => {
    bad(() => normalizeValidationConfig('text', { min: 1 }));
    bad(() => normalizeValidationConfig('boolean', { max: 1 }));
    bad(() => normalizeValidationConfig('number', { min: 5, max: 1 }));
    bad(() =>
      normalizeValidationConfig('text', { minLength: 5, maxLength: 2 }),
    );
    expect(normalizeValidationConfig('boolean', undefined)).toBeNull();
  });
});

describe('validateMetafieldValue', () => {
  it('text honours min/max length and the hard cap', () => {
    const cfg = { minLength: 2, maxLength: 4 };
    expect(validateMetafieldValue('text', cfg, 'abc')).toBe('abc');
    bad(() => validateMetafieldValue('text', cfg, 'a'));
    bad(() => validateMetafieldValue('text', cfg, 'abcde'));
    bad(() => validateMetafieldValue('text', null, 'x'.repeat(1001)));
    bad(() => validateMetafieldValue('text', null, 5));
  });

  it('number honours min/max/integer and refuses NaN/strings', () => {
    const cfg = { min: 0, max: 10, integer: true };
    expect(validateMetafieldValue('number', cfg, 10)).toBe(10);
    bad(() => validateMetafieldValue('number', cfg, 11));
    bad(() => validateMetafieldValue('number', cfg, -1));
    bad(() => validateMetafieldValue('number', cfg, 1.5));
    bad(() => validateMetafieldValue('number', cfg, '3'));
    bad(() => validateMetafieldValue('number', null, NaN));
  });

  it('boolean and date', () => {
    expect(validateMetafieldValue('boolean', null, false)).toBe(false);
    bad(() => validateMetafieldValue('boolean', null, 'true'));
    expect(validateMetafieldValue('date', null, '2026-02-28')).toBe(
      '2026-02-28',
    );
    bad(() => validateMetafieldValue('date', null, '2026-02-30'));
    bad(() => validateMetafieldValue('date', null, '28/02/2026'));
  });

  it('selects only accept declared options', () => {
    const cfg = { options: ['red', 'blue'] };
    expect(validateMetafieldValue('single_select', cfg, 'red')).toBe('red');
    bad(() => validateMetafieldValue('single_select', cfg, 'green'));
    bad(() => validateMetafieldValue('single_select', cfg, ['red']));
    expect(
      validateMetafieldValue('multi_select', cfg, ['red', 'blue']),
    ).toEqual(['red', 'blue']);
    bad(() => validateMetafieldValue('multi_select', cfg, ['red', 'red']));
    bad(() => validateMetafieldValue('multi_select', cfg, ['red', 'green']));
    bad(() => validateMetafieldValue('multi_select', cfg, 'red'));
  });

  it('json accepts any JSON but caps size', () => {
    expect(validateMetafieldValue('json', null, { a: [1, 2] })).toEqual({
      a: [1, 2],
    });
    bad(() => validateMetafieldValue('json', null, 'x'.repeat(10001)));
  });
});
