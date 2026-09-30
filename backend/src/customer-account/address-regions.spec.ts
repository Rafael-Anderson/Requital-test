import { mapAddressRegions } from './address-regions';

const regions = new Map([
  ['dubai', 2],
  ['sharjah', 3],
]);

describe('mapAddressRegions', () => {
  it('stamps regionId on a matching address, case and whitespace tolerant', () => {
    const r = mapAddressRegions(
      [{ id: 'a', emirate: ' DUBAI ', address: 'x' }],
      regions,
    );
    expect(r.addresses[0]).toEqual({
      id: 'a',
      emirate: ' DUBAI ',
      address: 'x',
      regionId: 2,
    });
    expect(r.mapped).toBe(1);
    expect(r.unmapped).toEqual([]);
  });

  it('leaves an unmatched address untouched and reports its value', () => {
    const r = mapAddressRegions([{ emirate: 'Atlantis' }], regions);
    expect(r.addresses[0]).toEqual({ emirate: 'Atlantis' });
    expect(r.unmapped).toEqual(['Atlantis']);
  });

  it('is idempotent: a second pass changes nothing', () => {
    const first = mapAddressRegions([{ emirate: 'Sharjah' }], regions);
    const second = mapAddressRegions(first.addresses, regions);
    expect(second.mapped).toBe(0);
    expect(second.alreadyMapped).toBe(1);
    expect(second.addresses).toEqual(first.addresses);
  });

  it('tolerates a null, non-array or empty-emirate value without fabricating a region', () => {
    expect(mapAddressRegions(null, regions).addresses).toEqual([]);
    const r = mapAddressRegions([{ emirate: '' }, {}], regions);
    expect(r.mapped).toBe(0);
    expect(r.unmapped).toEqual([]);
  });
});
