import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface AuthResponse {
  accessToken: string;
}
interface IdRow {
  id: number;
}
interface OutletRow {
  id: number;
}
interface OrderRow {
  id: number;
  trackingToken?: string;
}
interface NoteRow {
  id: number;
  note: string;
  author: { id: number; name: string };
  createdAt: string;
}
interface OrderDetail {
  id: number;
  ordernote: NoteRow[];
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Order internal notes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const runId = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function setupShop(slugPrefix: string) {
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Notes Test Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const categoryId = body<IdRow>(category).id;

    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Note Item ${Math.random()}`,
        price: 10,
        thumbnail: 'https://example.com/x.jpg',
        sku: `NOTE-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        categoryIds: [categoryId],
      })
      .expect(201);
    const productId = body<IdRow>(product).id;

    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName: 'Note Customer',
        customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
        customerAddress: '1 Test St',
        emirate: 'Dubai',
        orderType: 'delivery',
        outletId,
        items: [{ productId, quantity: 1 }],
      })
      .expect(201);

    return { adminToken, outletId, order: body<OrderRow>(order) };
  }

  it('adds a note that appears in the order detail with author + timestamp', async () => {
    const { adminToken, order } = await setupShop('notes-basic');

    const res = await request(app.getHttpServer())
      .post(`/orders/${order.id}/notes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'Called customer to confirm delivery time' })
      .expect(201);
    const created = body<NoteRow>(res);
    expect(created.note).toBe('Called customer to confirm delivery time');
    expect(created.author.name).toBe('Notes Test Admin');
    expect(created.createdAt).toBeTruthy();

    const detail = await request(app.getHttpServer())
      .get(`/orders/${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const notes = body<OrderDetail>(detail).ordernote;
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toBe('Called customer to confirm delivery time');
  });

  it('is a thread — multiple notes from different staff stack up, newest first, none overwritten', async () => {
    const { adminToken, order, outletId } = await setupShop('notes-thread');

    const staffEmail = `notes-thread-staff-${runId}@test.com`;
    await request(app.getHttpServer())
      .post('/auth/branch-users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Branch Staffer', email: staffEmail, password: 'password123', role: 'branch', outletId })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: staffEmail, password: 'password123' })
      .expect(201);
    const branchToken = body<AuthResponse>(login).accessToken;

    await request(app.getHttpServer())
      .post(`/orders/${order.id}/notes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'First note from admin' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/notes`)
      .set('Authorization', `Bearer ${branchToken}`)
      .send({ note: 'Second note from branch staff' })
      .expect(201);

    const detail = await request(app.getHttpServer())
      .get(`/orders/${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const notes = body<OrderDetail>(detail).ordernote;
    expect(notes).toHaveLength(2);
    expect(notes[0].note).toBe('Second note from branch staff'); // newest first
    expect(notes[1].note).toBe('First note from admin');
    expect(notes[0].author.name).toBe('Branch Staffer');
    expect(notes[1].author.name).toBe('Notes Test Admin');
  });

  it('never appears on the public tracking-token lookup', async () => {
    const { adminToken, order } = await setupShop('notes-public');
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/notes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'Internal-only: customer was rude on the phone' })
      .expect(201);

    // Fetch the real tracking token via the admin detail endpoint (not
    // returned by create), then hit the actual public lookup route.
    const detail = await request(app.getHttpServer())
      .get(`/orders/${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const raw = await prisma.order.findUnique({ where: { id: order.id }, select: { trackingToken: true } });

    const publicRes = await request(app.getHttpServer())
      .get(`/public/orders/lookup?token=${raw!.trackingToken}`)
      .expect(200);
    expect(JSON.stringify(publicRes.body)).not.toContain('rude on the phone');
    expect(publicRes.body.ordernote).toBeUndefined();
    void detail;
  });

  it('viewer can read notes but cannot add one', async () => {
    const { adminToken, order, outletId } = await setupShop('notes-viewer');
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/notes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'Existing note' })
      .expect(201);

    const staffEmail = `notes-viewer-staff-${runId}@test.com`;
    await request(app.getHttpServer())
      .post('/auth/branch-users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Viewer', email: staffEmail, password: 'password123', role: 'viewer' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: staffEmail, password: 'password123' })
      .expect(201);
    const viewerToken = body<AuthResponse>(login).accessToken;

    const detail = await request(app.getHttpServer())
      .get(`/orders/${order.id}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(body<OrderDetail>(detail).ordernote).toHaveLength(1);

    await request(app.getHttpServer())
      .post(`/orders/${order.id}/notes`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ note: 'Should be rejected' })
      .expect(403);
    void outletId;
  });

  it("adversarial: cannot add a note to another shop's order", async () => {
    const shopA = await setupShop('notes-tenant-a');
    const shopB = await setupShop('notes-tenant-b');

    await request(app.getHttpServer())
      .post(`/orders/${shopA.order.id}/notes`)
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .send({ note: 'Should not be allowed' })
      .expect(404);

    const detail = await request(app.getHttpServer())
      .get(`/orders/${shopA.order.id}`)
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .expect(200);
    expect(body<OrderDetail>(detail).ordernote).toHaveLength(0);
  });
});
