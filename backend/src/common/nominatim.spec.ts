import { geocodeAddress, reverseGeocodeAddress } from './nominatim';

describe('geocodeAddress', () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  it('bounds the lookup with a timeout signal so a hung call cannot hold an order open', async () => {
    let seen: RequestInit | undefined;
    global.fetch = ((_url: string, init?: RequestInit) => {
      seen = init;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([{ lat: '25.2', lon: '55.3', display_name: 'X' }]),
      });
    }) as unknown as typeof fetch;
    await geocodeAddress('Dubai Mall');
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  it('turns an aborted lookup into the existing generic 400', async () => {
    global.fetch = () => Promise.reject(new Error('timeout'));
    await expect(geocodeAddress('Dubai Mall')).rejects.toThrow(
      'Geocoding lookup failed',
    );
  });
});

describe('geocode body handling', () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  it('a body that fails to read is the existing 400, not a 500', async () => {
    global.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.reject(new Error('aborted while reading body')),
      })) as unknown as typeof fetch;
    await expect(geocodeAddress('Dubai Mall')).rejects.toMatchObject({
      status: 400,
    });
    await expect(reverseGeocodeAddress(25.2, 55.3)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('keeps the 404 for an empty result', async () => {
    global.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      })) as unknown as typeof fetch;
    await expect(geocodeAddress('nowhere')).rejects.toMatchObject({
      status: 404,
    });
  });
});
