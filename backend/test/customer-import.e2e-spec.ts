/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- supertest bodies and RowDataPacket rows are untyped */
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { buildXlsx } from './helpers/xlsx-fixture';
import { setupImportShop, type ImportShop } from './helpers/import-shop';

describe('Customers import (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let a: ImportShop;
  let b: ImportShop;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(DatabaseService);
    a = await setupImportShop(app, db, 'cus-a');
    b = await setupImportShop(app, db, 'cus-b');
  });

  afterAll(async () => {
    await app.close();
  });

  function send(
    kind: 'preview' | 'confirm',
    shop: ImportShop,
    file: Buffer | string,
    query: Record<string, string> = {},
    filename = 'customers.csv',
  ) {
    return request(app.getHttpServer())
      .post(`/customers/import/${kind}`)
      .query(query)
      .set('Authorization', `Bearer ${shop.token}`)
      .attach(
        'file',
        Buffer.isBuffer(file) ? file : Buffer.from(file),
        filename,
      );
  }
  const customers = (shopId: number) =>
    db.query<RowDataPacket[]>(
      `SELECT id, name, phone, email, addresses FROM customer WHERE shopId = ? ORDER BY id`,
      [shopId],
    );
  const insert = (
    shopId: number,
    name: string,
    phone: string,
    email: string | null = null,
  ) =>
    db.execute(
      `INSERT INTO customer (shopId, name, phone, email) VALUES (?, ?, ?, ?)`,
      [shopId, name, phone, email],
    );
  const jobCount = async (shopId: number) =>
    Number(
      (
        await db.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS c FROM job WHERE shopId = ?`,
          [shopId],
        )
      )[0].c,
    );
  const newsletterCount = async (shopId: number) =>
    Number(
      (
        await db.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS c FROM newslettersubscriber WHERE shopId = ?`,
          [shopId],
        )
      )[0].c,
    );

  it('previews without writing and imports new customers as E.164, Arabic kept', async () => {
    const csv = [
      'name,phone,email,address,city',
      'Sara,050 123 4567,sara@x.test,Villa 5,Dubai',
      'سارة محمد,٠٥٥٩٨٧٦٥٤٣,,,',
    ].join('\n');
    const before = await customers(a.shopId);
    const preview = (await send('preview', a, csv).expect(201)).body;
    expect(await customers(a.shopId)).toEqual(before);
    expect(preview.totals).toMatchObject({
      rows: 2,
      create: 2,
      conflict: 0,
      error: 0,
    });
    expect(preview.note).toMatch(/not subscribed/);
    // masked phone, no raw value, no email in the preview
    expect(JSON.stringify(preview)).not.toMatch(/501234567|sara@x\.test/);

    const res = (await send('confirm', a, csv).expect(201)).body;
    expect(res).toMatchObject({
      created: 2,
      updated: 0,
      conflicts: 0,
      errors: 0,
    });
    const rows = await customers(a.shopId);
    expect(rows.map((r) => [r.name, r.phone, r.email])).toEqual([
      ['Sara', '+971501234567', 'sara@x.test'],
      ['سارة محمد', '+971559876543', null],
    ]);
    expect(rows[0].addresses[0]).toMatchObject({
      address: 'Villa 5',
      area: 'Dubai',
    });
  });

  it('re-confirming the same file creates nothing', async () => {
    const csv = 'name,phone\nSara,0501234567\n';
    const res = (await send('confirm', a, csv).expect(201)).body;
    expect(res).toMatchObject({ created: 0, skipped: 1 });
    expect(await customers(a.shopId)).toHaveLength(2);
  });

  it('never creates a second row for a person stored in another spelling', async () => {
    // checkout stores phones RAW: three spellings of one number, in three shops' worth of habit
    await insert(a.shopId, 'Raw Person', '0507777777');
    const before = (await customers(a.shopId)).length;
    const csv = 'name,phone,email\nRaw P,+971 50 777 7777,raw@x.test\n';
    const preview = (
      await send('preview', a, csv, { onExisting: 'update' }).expect(201)
    ).body;
    expect(preview.totals).toMatchObject({ create: 0, update: 1 });
    await send('confirm', a, csv, { onExisting: 'update' }).expect(201);
    const rows = await customers(a.shopId);
    expect(rows).toHaveLength(before);
    const row = rows.find((r) => r.name === 'Raw Person')!;
    // kept its own phone spelling and its own name, gained only the empty email
    expect(row.phone).toBe('0507777777');
    expect(row.email).toBe('raw@x.test');
  });

  it('skip (the default) leaves an existing customer completely alone', async () => {
    await insert(a.shopId, 'Keep Me', '0506666666', 'old@x.test');
    const csv = 'name,phone,email\nChanged,00971506666666,new@x.test\n';
    const res = (await send('confirm', a, csv).expect(201)).body;
    expect(res).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    const row = (await customers(a.shopId)).find(
      (r) => r.phone === '0506666666',
    )!;
    expect(row).toMatchObject({ name: 'Keep Me', email: 'old@x.test' });
  });

  it('update never overwrites a name or an email', async () => {
    const csv = 'name,phone,email\nOther Name,0506666666,other@x.test\n';
    await send('confirm', a, csv, { onExisting: 'update' }).expect(201);
    const row = (await customers(a.shopId)).find(
      (r) => r.phone === '0506666666',
    )!;
    expect(row).toMatchObject({ name: 'Keep Me', email: 'old@x.test' });
  });

  it('the same person twice in one file is one row; differing details conflict and import neither', async () => {
    const csv = [
      'name,phone,email',
      'Dup One,0501110000,',
      'dup one,+971501110000,d@x.test',
      'Clash A,0502220000,',
      'Clash B,971502220000,',
    ].join('\n');
    const preview = (await send('preview', a, csv).expect(201)).body;
    expect(preview.totals).toMatchObject({ create: 1, skip: 1, conflict: 2 });
    await send('confirm', a, csv).expect(201);
    const rows = await customers(a.shopId);
    const dup = rows.filter((r) => /dup one/i.test(r.name));
    expect(dup).toHaveLength(1);
    expect(dup[0].email).toBe('d@x.test');
    expect(rows.filter((r) => /Clash/.test(r.name))).toHaveLength(0);
  });

  it('several existing rows that normalise to one number are a conflict, not a merge', async () => {
    await insert(a.shopId, 'Twin 1', '0503330000');
    await insert(a.shopId, 'Twin 2', '+971503330000');
    const before = (await customers(a.shopId)).length;
    const res = (
      await send(
        'confirm',
        a,
        'name,phone,email\nTwin,971503330000,t@x.test\n',
        { onExisting: 'update' },
      ).expect(201)
    ).body;
    expect(res).toMatchObject({ created: 0, updated: 0, conflicts: 1 });
    expect(await customers(a.shopId)).toHaveLength(before);
  });

  it('records no consent and sends nothing', async () => {
    const jobsBefore = await jobCount(a.shopId);
    const newsBefore = await newsletterCount(a.shopId);
    const csv =
      'name,phone,email,Accepts Marketing,Notes\nConsent Test,0504440000,c@x.test,yes,vip\n';
    const res = (await send('confirm', a, csv).expect(201)).body;
    expect(res.created).toBe(1);
    expect(res.report.warnings.join(' ')).toMatch(/never subscribes/);
    expect(res.report.unsupportedColumns).toEqual([
      'Accepts Marketing',
      'Notes',
    ]);
    expect(await jobCount(a.shopId)).toBe(jobsBefore);
    expect(await newsletterCount(a.shopId)).toBe(newsBefore);
    const cols = await db.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'customer'`,
    );
    expect(cols.map((c) => String(c.c)).join()).not.toMatch(
      /consent|marketing|subscri/i,
    );
  });

  it('reports bad rows by number without echoing the value, and writes nothing for them', async () => {
    const csv =
      'name,phone,email\n,0501110099,\nBad Phone,not-a-number-12345,secret@x.test\n';
    const res = (await send('confirm', a, csv).expect(201)).body;
    expect(res).toMatchObject({ created: 0, errors: 2 });
    const text = JSON.stringify(res);
    expect(text).not.toMatch(/12345|secret@x\.test/);
    expect(res.report.rows[0].errors.length).toBeGreaterThan(0);
  });

  it('reads an .xlsx, including a numeric phone cell that lost its leading zero', async () => {
    const xlsx = buildXlsx([
      ['name', 'phone'],
      ['Excel Person', 501239999],
    ]);
    const res = (await send('confirm', a, xlsx, {}, 'c.xlsx').expect(201)).body;
    expect(res.created).toBe(1);
    expect(
      (await customers(a.shopId)).some((r) => r.phone === '+971501239999'),
    ).toBe(true);
  });

  it('uses the shop country: a Saudi shop reads a local number as +966', async () => {
    const sa = await setupImportShop(app, db, 'cus-sa', 'Saudi Arabia');
    await send('confirm', sa, 'name,phone\nAli,0551234567\n').expect(201);
    expect((await customers(sa.shopId))[0].phone).toBe('+966551234567');
  });

  it('is scoped to the shop: another shop with the same number is a different customer', async () => {
    await send('confirm', b, 'name,phone\nSara B,0501234567\n').expect(201);
    expect(await customers(b.shopId)).toHaveLength(1);
    expect(
      (await customers(a.shopId)).find((r) => r.name === 'Sara'),
    ).toBeTruthy();
  });

  it('refuses a file without name and phone columns, requires admin login', async () => {
    const res = await send('preview', a, 'email\nx@y.test\n').expect(400);
    expect(res.body.missingColumns).toEqual(['name', 'phone']);
    await request(app.getHttpServer())
      .post('/customers/import/preview')
      .attach('file', Buffer.from('name,phone\nA,0501\n'), 'c.csv')
      .expect(401);
  });

  it('writes an audit row with counts only', async () => {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT metadata FROM auditlog WHERE shopId = ? AND action = 'customer.imported' ORDER BY id DESC LIMIT 1`,
      [a.shopId],
    );
    const meta = JSON.stringify(rows[0].metadata);
    expect(meta).toMatch(/created/);
    expect(meta).not.toMatch(/@|\+971|Sara/);
  });
});
