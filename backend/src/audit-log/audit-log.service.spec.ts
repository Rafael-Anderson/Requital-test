import { AuditLogService } from './audit-log.service';
import type { DatabaseService } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';

function make() {
  const db = { execute: jest.fn().mockResolvedValue({}) };
  const service = new AuditLogService(db as unknown as DatabaseService);
  const insertedLabel = () => (db.execute.mock.calls[0] as [string, unknown[]])[1][2];
  const insertedUser = () => (db.execute.mock.calls[0] as [string, unknown[]])[1][1];
  return { service, insertedLabel, insertedUser };
}
const base: TenantContext = { userId: 7, shopId: 3, role: 'admin', outletId: null };
const entry = { action: 'x', entityType: 'y' };

describe('AuditLogService.logCtx actor labels (F11)', () => {
  it('snapshots the staff name', async () => {
    const t = make();
    await t.service.logCtx({ ...base, userName: 'Layla' }, entry);
    expect(t.insertedLabel()).toBe('Layla');
    expect(t.insertedUser()).toBe(7);
  });

  it('labels an impersonated session as Requital support and keeps the user id', async () => {
    const t = make();
    await t.service.logCtx({ ...base, userName: 'Layla', impersonatedByPlatformAdminId: 9 }, entry);
    expect(t.insertedLabel()).toBe('Requital support (impersonating Layla)');
    expect(t.insertedUser()).toBe(7);
  });

  it('records a system context with its label and no user', async () => {
    const t = make();
    await t.service.logCtx({ ...base, systemActorLabel: 'system (payment gateway)' }, entry);
    expect(t.insertedLabel()).toBe('system (payment gateway)');
    expect(t.insertedUser()).toBeNull();
  });

  it('keeps the driver attribution and writes no label when the name is unknown', async () => {
    const d = make();
    await d.service.logCtx({ ...base, userId: 0, driver: { id: 1, name: 'Ahmed' } }, entry);
    expect(d.insertedLabel()).toBe('driver Ahmed');
    const n = make();
    await n.service.logCtx(base, entry);
    expect(n.insertedLabel()).toBeNull();
  });

  it('caps a very long name to the column width', async () => {
    const t = make();
    await t.service.logCtx({ ...base, userName: 'n'.repeat(500) }, entry);
    expect((t.insertedLabel() as string).length).toBe(191);
  });

  it('truncates by code point: an emoji at the cut is dropped whole, never split', async () => {
    const t = make();
    await t.service.logCtx({ ...base, userName: 'n'.repeat(190) + '\u{1F600}\u{1F600}' }, entry);
    const label = t.insertedLabel() as string;
    expect(Array.from(label)).toHaveLength(191);
    expect(label.endsWith('\u{1F600}')).toBe(true);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(label)).toBe(false);
  });
});
