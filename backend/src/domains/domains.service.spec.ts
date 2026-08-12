import { DomainsService } from './domains.service';
import type { DatabaseService } from '../database/database.service';

function createMockDb(rows: unknown[]) {
  const query = jest.fn().mockResolvedValue(rows);
  return { query } as unknown as DatabaseService & { query: jest.Mock };
}

describe('DomainsService.isKnownDomain', () => {
  it('looks up a {subdomain}.requital.io host by subdomain, not customDomain', async () => {
    const db = createMockDb([{ id: 1 }]);
    const service = new DomainsService(db);

    const result = await service.isKnownDomain('acme.requital.io');

    expect(result).toBe(true);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('subdomain = ?');
    expect(params).toEqual(['acme']);
  });

  it('returns false for an unclaimed {subdomain}.requital.io host', async () => {
    const db = createMockDb([]);
    const service = new DomainsService(db);

    expect(await service.isKnownDomain('nobody.requital.io')).toBe(false);
  });

  it('looks up a non-requital.io host by customDomain', async () => {
    const db = createMockDb([{ id: 1 }]);
    const service = new DomainsService(db);

    const result = await service.isKnownDomain('shop.acme.com');

    expect(result).toBe(true);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('customDomain = ?');
    expect(params).toEqual(['shop.acme.com']);
  });

  it('returns false for an unclaimed custom domain', async () => {
    const db = createMockDb([]);
    const service = new DomainsService(db);

    expect(await service.isKnownDomain('nobody.example.com')).toBe(false);
  });
});

describe('DomainsService.resolveSubdomain', () => {
  it('resolves a {subdomain}.requital.io host directly from the hostname, no lookup needed for the value itself', async () => {
    const db = createMockDb([{ id: 1 }]);
    const service = new DomainsService(db);

    expect(await service.resolveSubdomain('acme.requital.io')).toBe('acme');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('subdomain = ?');
    expect(params).toEqual(['acme']);
  });

  it('returns null for an unclaimed {subdomain}.requital.io host', async () => {
    const db = createMockDb([]);
    const service = new DomainsService(db);

    expect(await service.resolveSubdomain('nobody.requital.io')).toBeNull();
  });

  it('resolves a custom domain to its shop\'s real subdomain, not the custom domain itself', async () => {
    const db = createMockDb([{ subdomain: 'acme' }]);
    const service = new DomainsService(db);

    expect(await service.resolveSubdomain('shop.acme.com')).toBe('acme');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('customDomain = ?');
    expect(sql).toContain('subdomain');
    expect(params).toEqual(['shop.acme.com']);
  });

  it('returns null for an unclaimed custom domain', async () => {
    const db = createMockDb([]);
    const service = new DomainsService(db);

    expect(await service.resolveSubdomain('nobody.example.com')).toBeNull();
  });
});
