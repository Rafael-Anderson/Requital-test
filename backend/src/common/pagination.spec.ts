import 'reflect-metadata';
import {
  isPaginated,
  likeContains,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  resolvePage,
  toPage,
} from './pagination';

describe('pagination helper', () => {
  it('defaults to page 1 of 20', () => {
    expect(PAGE_SIZE_DEFAULT).toBe(20);
    expect(resolvePage({})).toEqual({ page: 1, pageSize: 20, limit: 20, offset: 0 });
  });

  it('computes the offset from the page', () => {
    expect(resolvePage({ page: 3, pageSize: 50 })).toEqual({
      page: 3,
      pageSize: 50,
      limit: 50,
      offset: 100,
    });
  });

  it('caps the page size even when the DTO was bypassed', () => {
    expect(PAGE_SIZE_MAX).toBe(100);
    expect(resolvePage({ pageSize: 5000 }).limit).toBe(100);
  });

  it('never produces a negative or fractional window', () => {
    expect(resolvePage({ page: -4, pageSize: -1 })).toMatchObject({
      page: 1,
      pageSize: 1,
      offset: 0,
    });
    expect(resolvePage({ page: 2.9, pageSize: 10.9 })).toMatchObject({
      page: 2,
      pageSize: 10,
      offset: 10,
    });
  });

  it('a caller default is honoured and still capped', () => {
    expect(resolvePage({}, { pageSize: 50 }).pageSize).toBe(50);
    expect(resolvePage({}, { pageSize: 9999 }).pageSize).toBe(100);
  });

  it('a request is paginated only when it carries page or pageSize', () => {
    expect(isPaginated({})).toBe(false);
    expect(isPaginated({ page: 1 })).toBe(true);
    expect(isPaginated({ pageSize: 20 })).toBe(true);
  });

  it('builds the shared envelope', () => {
    expect(toPage([1, 2], 7, 2, 2)).toEqual({ data: [1, 2], page: 2, pageSize: 2, total: 7 });
  });

  it('escapes LIKE wildcards so a search for 50% is literal', () => {
    expect(likeContains('50%_off\\')).toBe('%50\\%\\_off\\\\%');
    expect(likeContains('rose')).toBe('%rose%');
  });
});
