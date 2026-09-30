import { describeLegacyMatching, proposeRegions } from './zone-region-mapping';

const uae = [
  { id: 1, nameEn: 'Abu Dhabi', nameAr: 'أبوظبي' },
  { id: 2, nameEn: 'Dubai', nameAr: 'دبي' },
  { id: 3, nameEn: 'Sharjah', nameAr: 'الشارقة' },
  { id: 4, nameEn: 'Ajman', nameAr: 'عجمان' },
];

describe('proposeRegions', () => {
  it('a zone named exactly for a region is proposed that region, confidently', () => {
    const p = proposeRegions('Dubai', uae);
    expect(p).toMatchObject({
      regionIds: [2],
      reason: 'exact-name',
      confident: true,
    });
  });

  it('ignores case and surrounding or repeated whitespace', () => {
    expect(proposeRegions('  sharjah ', uae).regionIds).toEqual([3]);
    expect(proposeRegions('Abu   Dhabi', uae).regionIds).toEqual([1]);
  });

  it('matches the Arabic name too', () => {
    expect(proposeRegions('دبي', uae)).toMatchObject({
      regionIds: [2],
      reason: 'exact-name',
    });
  });

  it('a list of region names is split, confidently, only when EVERY token is a region', () => {
    expect(proposeRegions('Dubai/Sharjah/Ajman', uae)).toMatchObject({
      regionIds: [2, 3, 4],
      reason: 'token-split',
      confident: true,
    });
    expect(proposeRegions('Dubai, Sharjah', uae).regionIds).toEqual([2, 3]);
    expect(proposeRegions('Dubai and Ajman', uae).regionIds).toEqual([2, 4]);
  });

  it('"Dubai Full" is NOT an exact match: it is proposed Dubai, but only as something to check', () => {
    const p = proposeRegions('Dubai Full', uae);
    expect(p.regionIds).toEqual([2]);
    expect(p.reason).toBe('contains-name');
    expect(p.confident).toBe(false);
    expect(p.explanation).toContain('Dubai');
  });

  it('a partial list never quietly drops the part it could not read', () => {
    const p = proposeRegions('Dubai, Atlantis', uae);
    expect(p.reason).toBe('contains-name');
    expect(p.confident).toBe(false);
  });

  it('an abbreviation list proposes nothing rather than guessing', () => {
    expect(proposeRegions('DXB/SHJ/AJM', uae)).toMatchObject({
      regionIds: [],
      reason: 'none',
      confident: false,
    });
  });

  it('a sub-area name proposes nothing', () => {
    expect(proposeRegions('Marina', uae).reason).toBe('none');
  });

  it('does not match a region inside another word', () => {
    expect(proposeRegions('Dubaiville', uae).reason).toBe('none');
  });

  it('a zone name with regex metacharacters is safe', () => {
    expect(() => proposeRegions('(Dubai', uae)).not.toThrow();
    expect(() => proposeRegions('.*', uae)).not.toThrow();
  });
});

describe('describeLegacyMatching', () => {
  it('a zone named for a region matches that emirate by name and the typed area', () => {
    const text = describeLegacyMatching(
      { name: 'Dubai', hasPlacedCircle: false },
      uae,
    );
    expect(text).toContain('whose emirate is Dubai');
    expect(text).toContain('types the area "Dubai"');
  });

  it('any other name matches only the exact typed area, plus its circle when placed', () => {
    expect(
      describeLegacyMatching({ name: 'Marina', hasPlacedCircle: false }, uae),
    ).toBe(
      'Currently matches only customers who type the area "Marina" exactly.',
    );
    expect(
      describeLegacyMatching({ name: 'Marina', hasPlacedCircle: true }, uae),
    ).toContain('map pin is inside its circle');
  });
});
