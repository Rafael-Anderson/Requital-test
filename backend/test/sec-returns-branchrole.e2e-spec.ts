import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { verifySignupEmail } from './helpers/verify-signup-email';

jest.setTimeout(30000);

type B = Record<string, any>;

// SECURITY REPRO: a branch user whose branch role at the outlet is view-only
// (['orders.view']) is refused orders.manage endpoints (status change) but can
// still POST /orders/:id/returns, which issues a refund (provider refund
// attempt, gift-card credit, stock restock). ReturnsService.create only calls
// OrdersService.findOne (orders.view), never assertPermission(..,'orders.manage').
describe('SEC repro: returns.create ignores the branch-role orders.manage restriction', () => {
  let app: INestApplication<App>;
  const runId = Date.now();
  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('view-only branch role cannot create a return (expect 403)', async () => {
    const h = () => request(app.getHttpServer());
    const slug = `sec-ret-${runId}`;
    const signup = await h()
      .post('/auth/signup')
      .send({ name: 'Admin', email: `${slug}@test.com`, password: 'password123', shopName: slug, subdomain: slug })
      .expect(201);
    await verifySignupEmail(app.getHttpServer(), (signup.body as B).devVerificationLink);
    const admin = (signup.body as B).accessToken as string;
    const A = (t: string) => ({ Authorization: `Bearer ${t}` });
    const me = (await h().get('/auth/me').set(A(admin))).body as B;
    const outletId = ((await h().get('/outlets').set(A(admin)).expect(200)).body as B[])[0].id as number;
    const col = ((await h().post('/collections').set(A(admin)).send({ name: 'G' }).expect(201)).body as B).id as number;
    const prod = (
      await h().post('/products').set(A(admin)).send({
        name: 'P', price: 20, thumbnail: 'https://example.com/x.jpg', sku: `S-${runId}`, collectionIds: [col],
      }).expect(201)
    ).body as B;
    const order = (
      await h().post('/orders').set(A(admin)).send({
        customerName: 'C', customerPhone: `05${Math.floor(Math.random() * 1e8)}`, customerAddress: 'x',
        orderType: 'delivery', outletId, items: [{ productId: prod.id, quantity: 2 }],
      }).expect(201)
    ).body as B;
    for (const status of ['confirmed', 'preparing', 'out_for_delivery', 'delivered']) {
      await h().patch(`/orders/${order.id}/status`).set(A(admin)).send({ status }).expect(200);
    }
    const detail = (await h().get(`/orders/${order.id}`).set(A(admin)).expect(200)).body as B;

    const staffEmail = `${slug}-staff@test.com`;
    await h().post('/auth/branch-users').set(A(admin)).send({
      name: 'Staff', email: staffEmail, password: 'password123', role: 'branch', outletId,
    }).expect(201);
    const staff = ((await h().post('/auth/login').send({ email: staffEmail, password: 'password123' }).expect(201)).body as B).accessToken as string;
    const staffId = ((await h().get('/auth/me').set(A(staff))).body as B).id as number;
    const role = (await h().post('/shop/branch-roles').set(A(admin)).send({ name: 'ViewOnly', permissions: ['orders.view'] }).expect(201)).body as B;
    await h().post('/shop/branch-roles/assignments').set(A(admin)).send({ userId: staffId, outletId, branchRoleId: role.id }).expect(201);
    void me;

    // Control: the same restricted user is refused another orders.manage action.
    await h().post(`/orders/${order.id}/notes`).set(A(staff)).send({ note: 'x' }).expect(403);

    // The refund: must be refused, is accepted (201).
    const res = await h()
      .post(`/orders/${order.id}/returns`)
      .set(A(staff))
      .send({ items: [{ orderItemId: detail.orderitem[0].id, quantity: 2 }], reason: 'damaged' });
    expect(res.status).toBe(403);
  });
});
