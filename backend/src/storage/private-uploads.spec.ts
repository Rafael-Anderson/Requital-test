import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFileSync } from 'fs';
import { blockPrivateUploads, isPrivateUploadPath } from './private-uploads';

describe('private uploads', () => {
  const root = mkdtempSync(join(tmpdir(), 'uploads-'));
  mkdirSync(join(root, 'delivery-proof', '1'), { recursive: true });
  mkdirSync(join(root, 'products', '1'), { recursive: true });
  writeFileSync(join(root, 'delivery-proof', '1', 'k.jpg'), 'secret');
  writeFileSync(join(root, 'products', '1', 'p.jpg'), 'public');
  const app = express();
  app.use('/uploads', blockPrivateUploads);
  app.use('/uploads', express.static(root));

  it.each([
    '/uploads/delivery-proof/1/k.jpg',
    '/uploads/Delivery-Proof/1/k.jpg',
    '/uploads/%64elivery-proof/1/k.jpg',
    '/uploads//delivery-proof/1/k.jpg',
    '/uploads/products/../delivery-proof/1/k.jpg',
    '/uploads/./delivery-proof/1/k.jpg',
  ])('refuses %s', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(404);
    expect(String(res.body)).not.toContain('secret');
  });

  it('still serves public uploads', async () => {
    const res = await request(app).get('/uploads/products/1/p.jpg');
    expect(res.status).toBe(200);
    expect(String(res.body)).toBe('public');
  });

  it('refuses a malformed escape', () => {
    expect(isPrivateUploadPath('/%E0%A4%A')).toBe(true);
  });

  it('main.ts mounts the block before the static handler', () => {
    const src = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    const block = src.indexOf("app.use('/uploads', blockPrivateUploads)");
    expect(block).toBeGreaterThan(-1);
    expect(block).toBeLessThan(src.indexOf('app.useStaticAssets'));
  });
});
