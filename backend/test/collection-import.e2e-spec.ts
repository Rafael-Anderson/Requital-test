/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest bodies and RowDataPacket rows are untyped */
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

describe('Collections import (e2e)', () => {
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
    a = await setupImportShop(app, db, 'col-a');
    b = await setupImportShop(app, db, 'col-b');
  });

  afterAll(async () => {
    await app.close();
  });

  function send(
    kind: 'preview' | 'confirm',
    shop: ImportShop,
    file: Buffer | string,
    query: Record<string, string> = {},
    filename = 'collections.csv',
  ) {
    return request(app.getHttpServer())
      .post(`/collections/import/${kind}`)
      .query(query)
      .set('Authorization', `Bearer ${shop.token}`)
      .attach(
        'file',
        Buffer.isBuffer(file) ? file : Buffer.from(file),
        filename,
      );
  }
  const tree = async (shopId: number) => {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT c.name, c.slug, c.description, c.image, p.name AS parent
         FROM collection c LEFT JOIN collection p ON p.id = c.parentCollectionId
        WHERE c.shopId = ? ORDER BY c.id`,
      [shopId],
    );
    return rows.map((r) => [r.name, r.parent, r.slug, r.description, r.image]);
  };

  it('previews without writing, then builds a multi-level tree whatever the row order', async () => {
    const csv = [
      'name,parent,description,image',
      'Leaf,Mid,Small things,https://cdn.example.test/l.png',
      'Mid,Top,,',
      'Top,,,',
      'ورد,Top,باقات,',
    ].join('\n');
    const before = await tree(a.shopId);
    const preview = (await send('preview', a, csv).expect(201)).body;
    expect(await tree(a.shopId)).toEqual(before);
    expect(preview.totals).toMatchObject({ create: 4, error: 0 });

    const res = (await send('confirm', a, csv).expect(201)).body;
    expect(res).toMatchObject({ created: 4, errors: 0 });
    const t = await tree(a.shopId);
    expect(t.slice(1)).toEqual([
      ['Top', null, 'top', null, null],
      ['Mid', 'Top', 'mid', null, null],
      ['Leaf', 'Mid', 'leaf', 'Small things', 'https://cdn.example.test/l.png'],
      ['ورد', 'Top', 'ورد', 'باقات', null],
    ]);
  });

  it('re-confirming the same file changes nothing', async () => {
    const csv = 'name,parent\nTop,\nMid,Top\nLeaf,Mid\n';
    const res = (await send('confirm', a, csv).expect(201)).body;
    expect(res).toMatchObject({ created: 0, updated: 0, skipped: 3 });
  });

  it('refuses a cycle and a move under its own descendant, and writes nothing', async () => {
    const before = await tree(a.shopId);
    const csv = 'name,parent\nTop,Leaf\nSelf,Self\nX,Y\nY,X\n';
    const res = (
      await send('confirm', a, csv, { onExisting: 'update' }).expect(201)
    ).body;
    expect(res).toMatchObject({ created: 0, updated: 0, errors: 4 });
    expect(
      res.report.rows.every((r: { errors: string[] }) =>
        r.errors.join().match(/loops back/),
      ),
    ).toBe(true);
    expect(await tree(a.shopId)).toEqual(before);
  });

  it('update moves a collection, fills a description, and never clears one', async () => {
    const csv = 'name,parent,description\nLeaf,Top,Moved up\n';
    const res = (
      await send('confirm', a, csv, { onExisting: 'update' }).expect(201)
    ).body;
    expect(res).toMatchObject({ updated: 1 });
    expect((await tree(a.shopId)).find((r) => r[0] === 'Leaf')).toEqual([
      'Leaf',
      'Top',
      'leaf',
      'Moved up',
      'https://cdn.example.test/l.png',
    ]);
    await send('confirm', a, 'name,description,image\nLeaf,,\n', {
      onExisting: 'update',
    }).expect(201);
    expect((await tree(a.shopId)).find((r) => r[0] === 'Leaf')![3]).toBe(
      'Moved up',
    );
  });

  it('skip leaves existing collections alone even with new data', async () => {
    const res = (
      await send('confirm', a, 'name,description\nTop,CHANGED\n').expect(201)
    ).body;
    expect(res).toMatchObject({ skipped: 1, updated: 0 });
    expect((await tree(a.shopId)).find((r) => r[0] === 'Top')![3]).toBeNull();
  });

  it('matches by slug, and asks for a slug when two collections share a name', async () => {
    await db.execute(
      `INSERT INTO collection (shopId, name, slug, displayOrder) VALUES (?, 'Sale', 'sale-m', 0), (?, 'Sale', 'sale-w', 0)`,
      [a.shopId, a.shopId],
    );
    const ambiguous = (await send('preview', a, 'name\nSale\n').expect(201))
      .body;
    expect(ambiguous.rows[0].errors.join()).toMatch(/slug column/);
    const bySlug = (
      await send('confirm', a, 'name,slug,description\nSale,sale-w,Women\n', {
        onExisting: 'update',
      }).expect(201)
    ).body;
    expect(bySlug).toMatchObject({ updated: 1 });
    const rows = await db.query<RowDataPacket[]>(
      `SELECT slug, description FROM collection WHERE shopId = ? AND name = 'Sale' ORDER BY slug`,
      [a.shopId],
    );
    expect(rows.map((r) => [r.slug, r.description])).toEqual([
      ['sale-m', null],
      ['sale-w', 'Women'],
    ]);
  });

  it('a parent is never taken from another shop', async () => {
    await send('confirm', b, 'name\nOnly In B\n').expect(201);
    const res = (
      await send('confirm', a, 'name,parent\nSpy,Only In B\n').expect(201)
    ).body;
    expect(res).toMatchObject({ created: 0, errors: 1 });
    expect(res.report.rows[0].errors.join()).toMatch(/Parent was not found/);
    const spy = await db.query<RowDataPacket[]>(
      `SELECT id FROM collection WHERE shopId = ? AND name = 'Spy'`,
      [a.shopId],
    );
    expect(spy).toHaveLength(0);
  });

  it('imports a deep chain (unlimited depth)', async () => {
    const lines = ['name,parent'];
    for (let i = 0; i < 60; i += 1)
      lines.push(`deep${i},${i === 0 ? '' : `deep${i - 1}`}`);
    const res = (await send('confirm', a, lines.join('\n')).expect(201)).body;
    expect(res).toMatchObject({ created: 60, errors: 0 });
    const depth = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM collection WHERE shopId = ? AND name LIKE 'deep%' AND parentCollectionId IS NOT NULL`,
      [a.shopId],
    );
    expect(Number(depth[0].c)).toBe(59);
  });

  it('reads an .xlsx and refuses a file with no name column; admin login required', async () => {
    const xlsx = buildXlsx([['اسم التصنيف'], ['من اكسل']]);
    const res = (await send('confirm', a, xlsx, {}, 'c.xlsx').expect(201)).body;
    expect(res.created).toBe(1);
    await send('preview', a, 'foo\nbar\n').expect(400);
    await request(app.getHttpServer())
      .post('/collections/import/preview')
      .attach('file', Buffer.from('name\nA\n'), 'c.csv')
      .expect(401);
  });

  it('writes an audit row with counts only', async () => {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT metadata FROM auditlog WHERE shopId = ? AND action = 'collection.imported' ORDER BY id DESC LIMIT 1`,
      [a.shopId],
    );
    expect(JSON.stringify(rows[0].metadata)).toMatch(/created/);
  });
});
