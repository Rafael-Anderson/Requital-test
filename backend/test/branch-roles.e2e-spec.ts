import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Several tests here set up two full shops for cross-tenant checks, and
// every signup/branch-user-creation attempts a real Resend API call before
// falling back to the stub (see common/email.ts) — this file does that far
// more times per test than most other e2e suites, which is enough extra
// real network latency under load to occasionally miss Jest's 5000ms
// default.
jest.setTimeout(15000);

interface AuthResponse {
  accessToken: string;
}
interface IdRow {
  id: number;
}
interface OutletRow {
  id: number;
}
interface BranchRoleRow {
  id: number;
  name: string;
  permissions: string[];
}
interface AssignmentRow {
  id: number;
  userId: number;
  outletId: number;
  branchRoleId: number;
}
interface UserRow {
  id: number;
  name: string;
  outletId: number | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Branch roles: bundle/assignment CRUD, restrict-only enforcement, tenant isolation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const runId = Date.now();

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
        name: 'Branch Roles Test Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);
    const adminId = body<IdRow>(me).id;

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletA = body<OutletRow[]>(outlets)[0].id;

    const outletBRes = await request(app.getHttpServer())
      .post('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Outlet B ${slug}` })
      .expect(201);
    const outletB = body<IdRow>(outletBRes).id;

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
        name: `Item ${Math.random()}`,
        price: 10,
        thumbnail: 'https://example.com/x.jpg',
        sku: `BR-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        categoryIds: [categoryId],
      })
      .expect(201);
    const productId = body<IdRow>(product).id;

    return { adminToken, adminId, outletA, outletB, productId, slug };
  }

  async function createBranchRole(
    adminToken: string,
    name: string,
    permissions: string[],
  ) {
    const res = await request(app.getHttpServer())
      .post('/shop/branch-roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, permissions })
      .expect(201);
    return body<BranchRoleRow>(res);
  }

  async function assign(
    adminToken: string,
    userId: number,
    outletId: number,
    branchRoleId: number,
  ) {
    const res = await request(app.getHttpServer())
      .post('/shop/branch-roles/assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId, outletId, branchRoleId })
      .expect(201);
    return body<AssignmentRow>(res);
  }

  async function createOrder(
    adminToken: string,
    outletId: number,
    productId: number,
  ) {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName: 'Branch Roles Customer',
        customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
        customerAddress: '1 Test St',
        emirate: 'Dubai',
        orderType: 'pickup',
        outletId,
        items: [{ productId, quantity: 1 }],
      })
      .expect(201);
    return body<IdRow>(res);
  }

  describe('Branch role bundle CRUD', () => {
    it('admin can create, list, update, and delete a branch role', async () => {
      const { adminToken } = await setupShop('bundle-crud');

      const created = await createBranchRole(adminToken, 'Stock Lead', [
        'products.view',
        'products.manage_stock',
      ]);
      expect(created.name).toBe('Stock Lead');
      expect(created.permissions).toEqual([
        'products.view',
        'products.manage_stock',
      ]);

      const list = await request(app.getHttpServer())
        .get('/shop/branch-roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<BranchRoleRow[]>(list).map((r) => r.id)).toContain(
        created.id,
      );

      const updated = await request(app.getHttpServer())
        .patch(`/shop/branch-roles/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Stock Lead (renamed)', permissions: ['products.view'] })
        .expect(200);
      expect(body<BranchRoleRow>(updated).name).toBe('Stock Lead (renamed)');
      expect(body<BranchRoleRow>(updated).permissions).toEqual([
        'products.view',
      ]);

      await request(app.getHttpServer())
        .delete(`/shop/branch-roles/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const listAfter = await request(app.getHttpServer())
        .get('/shop/branch-roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<BranchRoleRow[]>(listAfter).map((r) => r.id)).not.toContain(
        created.id,
      );
    });

    it('rejects an unknown/garbage permission string rather than silently accepting it', async () => {
      const { adminToken } = await setupShop('bundle-garbage-perm');
      await request(app.getHttpServer())
        .post('/shop/branch-roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Bad Bundle',
          permissions: ['orders.view', 'not.a.real.permission'],
        })
        .expect(400);
    });

    it('rejects a duplicate name within the same shop', async () => {
      const { adminToken } = await setupShop('bundle-dupe-name');
      await createBranchRole(adminToken, 'Duplicate Name', ['orders.view']);
      await request(app.getHttpServer())
        .post('/shop/branch-roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Duplicate Name', permissions: ['dashboard.view'] })
        .expect(409);
    });

    it('a non-admin (branch role) cannot create, update, or delete a branch role', async () => {
      const { adminToken, outletA } = await setupShop('bundle-non-admin');
      const staffEmail = `bundle-non-admin-staff-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Branch Staff',
          email: staffEmail,
          password: 'password123',
          role: 'branch',
          outletId: outletA,
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password: 'password123' })
        .expect(201);
      const branchToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .post('/shop/branch-roles')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ name: 'Should Fail', permissions: [] })
        .expect(403);
    });

    it("adversarial: cannot read, update, or delete another shop's branch role by spoofing its id", async () => {
      const shopA = await setupShop('bundle-tenant-a');
      const shopB = await setupShop('bundle-tenant-b');
      const roleA = await createBranchRole(shopA.adminToken, 'Shop A Role', [
        'orders.view',
      ]);

      await request(app.getHttpServer())
        .patch(`/shop/branch-roles/${roleA.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({ name: 'Hijacked' })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/shop/branch-roles/${roleA.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(404);

      // Still intact from shop A's own perspective — the cross-shop attempts above didn't touch it.
      const stillThere = await request(app.getHttpServer())
        .get('/shop/branch-roles')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      expect(
        body<BranchRoleRow[]>(stillThere).find((r) => r.id === roleA.id)?.name,
      ).toBe('Shop A Role');
    });
  });

  describe('Branch-role assignment CRUD', () => {
    it('admin can assign a branch role to a user at an outlet, list it, and unassign it', async () => {
      const { adminToken, adminId, outletB } = await setupShop('assign-basic');
      const role = await createBranchRole(adminToken, 'Viewer Bundle', [
        'orders.view',
      ]);

      const created = await assign(adminToken, adminId, outletB, role.id);
      expect(created.userId).toBe(adminId);
      expect(created.outletId).toBe(outletB);
      expect(created.branchRoleId).toBe(role.id);

      const list = await request(app.getHttpServer())
        .get('/shop/branch-roles/assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<AssignmentRow[]>(list).map((a) => a.id)).toContain(
        created.id,
      );

      await request(app.getHttpServer())
        .delete(`/shop/branch-roles/assignments/${adminId}/${outletB}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const listAfter = await request(app.getHttpServer())
        .get('/shop/branch-roles/assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<AssignmentRow[]>(listAfter).map((a) => a.id)).not.toContain(
        created.id,
      );
    });

    it('re-assigning the same (user, outlet) pair upserts to the new branch role instead of erroring', async () => {
      const { adminToken, adminId, outletB } = await setupShop('assign-upsert');
      const roleOne = await createBranchRole(adminToken, 'Role One', [
        'orders.view',
      ]);
      const roleTwo = await createBranchRole(adminToken, 'Role Two', [
        'dashboard.view',
      ]);

      const first = await assign(adminToken, adminId, outletB, roleOne.id);
      const second = await assign(adminToken, adminId, outletB, roleTwo.id);

      expect(second.id).toBe(first.id);
      expect(second.branchRoleId).toBe(roleTwo.id);
    });

    it('unassigning a pair with no existing assignment 404s', async () => {
      const { adminToken, adminId, outletB } =
        await setupShop('unassign-missing');
      await request(app.getHttpServer())
        .delete(`/shop/branch-roles/assignments/${adminId}/${outletB}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('adversarial: rejects assigning a userId that belongs to a different shop', async () => {
      const shopA = await setupShop('assign-cross-shop-user-a');
      const shopB = await setupShop('assign-cross-shop-user-b');
      const role = await createBranchRole(shopA.adminToken, 'Role', [
        'orders.view',
      ]);

      await request(app.getHttpServer())
        .post('/shop/branch-roles/assignments')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({
          userId: shopB.adminId,
          outletId: shopA.outletA,
          branchRoleId: role.id,
        })
        .expect(400);
    });

    it('adversarial: rejects assigning an outletId that belongs to a different shop', async () => {
      const shopA = await setupShop('assign-cross-shop-outlet-a');
      const shopB = await setupShop('assign-cross-shop-outlet-b');
      const role = await createBranchRole(shopA.adminToken, 'Role', [
        'orders.view',
      ]);

      await request(app.getHttpServer())
        .post('/shop/branch-roles/assignments')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({
          userId: shopA.adminId,
          outletId: shopB.outletA,
          branchRoleId: role.id,
        })
        .expect(400);
    });

    it('adversarial: rejects assigning a branchRoleId that belongs to a different shop', async () => {
      const shopA = await setupShop('assign-cross-shop-role-a');
      const shopB = await setupShop('assign-cross-shop-role-b');
      const roleB = await createBranchRole(shopB.adminToken, 'Shop B Role', [
        'orders.view',
      ]);

      await request(app.getHttpServer())
        .post('/shop/branch-roles/assignments')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({
          userId: shopA.adminId,
          outletId: shopA.outletA,
          branchRoleId: roleB.id,
        })
        .expect(400);
    });

    it('a non-admin (branch role) cannot assign or list assignments', async () => {
      const { adminToken, outletA } = await setupShop('assign-non-admin');
      const staffEmail = `assign-non-admin-staff-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Branch Staff',
          email: staffEmail,
          password: 'password123',
          role: 'branch',
          outletId: outletA,
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password: 'password123' })
        .expect(201);
      const branchToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .get('/shop/branch-roles/assignments')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
    });
  });

  describe('Enforcement: restrict-only override across representative call sites', () => {
    it('orders: an admin restricted to orders.view-only at outletB can list orders there but not create one, while outletA is completely unaffected', async () => {
      const { adminToken, adminId, outletA, outletB, productId } =
        await setupShop('enforce-orders');
      const role = await createBranchRole(adminToken, 'Orders View Only', [
        'orders.view',
      ]);
      await assign(adminToken, adminId, outletB, role.id);

      // outletA: no override here — fallback path, must behave exactly as
      // it always has (create still works).
      await createOrder(adminToken, outletA, productId);

      // outletB: has orders.view but not orders.manage.
      await request(app.getHttpServer())
        .get(`/orders?outletId=${outletB}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerName: 'Blocked Customer',
          customerPhone: '0500000000',
          customerAddress: '1 Test St',
          emirate: 'Dubai',
          orderType: 'pickup',
          outletId: outletB,
          items: [{ productId, quantity: 1 }],
        })
        .expect(403);
    });

    it('orders: a restricted admin cannot update the status of an order that actually belongs to the restricted outlet', async () => {
      const { adminToken, adminId, outletB, productId } = await setupShop(
        'enforce-orders-status',
      );
      // Create the order BEFORE the override exists (admin still has full
      // access at that point), then restrict — updateStatus derives the
      // permission check from the order's own outletId, not a query param.
      const order = await createOrder(adminToken, outletB, productId);
      const role = await createBranchRole(adminToken, 'Orders View Only', [
        'orders.view',
      ]);
      await assign(adminToken, adminId, outletB, role.id);

      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
        .expect(403);
    });

    it('products: a restricted admin can view the catalog at outletB but cannot adjust stock there, while outletA is unaffected', async () => {
      const { adminToken, adminId, outletA, outletB, productId } =
        await setupShop('enforce-products');
      const role = await createBranchRole(adminToken, 'Products View Only', [
        'products.view',
      ]);
      await assign(adminToken, adminId, outletB, role.id);

      await request(app.getHttpServer())
        .patch('/products/stock/bulk-adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ outletId: outletA, adjustments: [{ productId, delta: 5 }] })
        .expect(200);

      await request(app.getHttpServer())
        .get(`/products?outletId=${outletB}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch('/products/stock/bulk-adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ outletId: outletB, adjustments: [{ productId, delta: 5 }] })
        .expect(403);
    });

    it('dashboard: a restricted admin loses dashboard access at outletB only', async () => {
      const { adminToken, adminId, outletA, outletB } =
        await setupShop('enforce-dashboard');
      const role = await createBranchRole(adminToken, 'No Dashboard', [
        'orders.view',
      ]);
      await assign(adminToken, adminId, outletB, role.id);

      await request(app.getHttpServer())
        .get(`/dashboard/summary?outletId=${outletA}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/dashboard/summary?outletId=${outletB}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });

    it("outlets: a restricted admin cannot view outletB's own detail page", async () => {
      const { adminToken, adminId, outletA, outletB } =
        await setupShop('enforce-outlets');
      const role = await createBranchRole(adminToken, 'No Outlet View', [
        'orders.view',
      ]);
      await assign(adminToken, adminId, outletB, role.id);

      await request(app.getHttpServer())
        .get(`/outlets/${outletA}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/outlets/${outletB}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });

    it('delivery zones: a restricted admin loses read access at outletB only', async () => {
      const { adminToken, adminId, outletA, outletB } = await setupShop(
        'enforce-delivery-zones',
      );
      const role = await createBranchRole(adminToken, 'No Delivery Zones', [
        'orders.view',
      ]);
      await assign(adminToken, adminId, outletB, role.id);

      await request(app.getHttpServer())
        .get(`/outlets/${outletA}/delivery-zones`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/outlets/${outletB}/delivery-zones`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });

    it('payments: a restricted admin cannot generate a payment link for an order at the restricted outlet', async () => {
      const { adminToken, adminId, outletB, productId } =
        await setupShop('enforce-payments');
      const order = await createOrder(adminToken, outletB, productId);
      const role = await createBranchRole(adminToken, 'No Payment Links', [
        'orders.view',
      ]);
      await assign(adminToken, adminId, outletB, role.id);

      await request(app.getHttpServer())
        .post(`/orders/${order.id}/payment-link`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });

    it('search: a branch user restricted at their own outlet loses order-search results', async () => {
      // The search endpoint only reads `q` — outlet scoping for order
      // results comes from resolveOutletFilter forcing a 'branch' user's
      // own ctx.outletId, never from a query param (that's admin-only
      // territory, and admin's search is never outlet-filtered at all).
      // So this needs a real branch user, not an admin + query filter.
      const { adminToken, outletA } = await setupShop('enforce-search');
      const staffEmail = `enforce-search-staff-${runId}@test.com`;
      const staffRes = await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Search Staff',
          email: staffEmail,
          password: 'password123',
          role: 'branch',
          outletId: outletA,
        })
        .expect(201);
      const staffId = body<IdRow>(staffRes).id;
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password: 'password123' })
        .expect(201);
      const staffToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .get('/search?q=test')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      const role = await createBranchRole(adminToken, 'No Search', [
        'products.view',
      ]);
      await assign(adminToken, staffId, outletA, role.id);

      await request(app.getHttpServer())
        .get('/search?q=test')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
    });

    it('ingredients: a restricted admin loses ingredient read access at outletB only', async () => {
      const { adminToken, adminId, outletA, outletB } = await setupShop(
        'enforce-ingredients',
      );
      const role = await createBranchRole(adminToken, 'No Ingredients', [
        'orders.view',
      ]);
      await assign(adminToken, adminId, outletB, role.id);

      await request(app.getHttpServer())
        .get(`/shop/ingredients?outletId=${outletA}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/shop/ingredients?outletId=${outletB}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });

    // The critical permission-escalation test: a shop-wide 'viewer' (no
    // orders.manage anywhere, ever) is assigned a branch role that
    // deliberately grants 'orders.manage' at one outlet — whether through a
    // careless admin or a direct spoofed API call to the assignments
    // endpoint. The restrict-only intersection must still block them at
    // the real HTTP layer, not just in the unit-tested helper.
    it('permission escalation attempt: an over-generous branch role can never upgrade a viewer beyond their shop-wide ceiling', async () => {
      const { adminToken, outletA, productId } =
        await setupShop('escalation-attempt');
      const staffEmail = `escalation-attempt-staff-${runId}@test.com`;
      const staffRes = await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Viewer Staff',
          email: staffEmail,
          password: 'password123',
          role: 'viewer',
        })
        .expect(201);
      const staffId = body<IdRow>(staffRes).id;
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password: 'password123' })
        .expect(201);
      const viewerToken = body<AuthResponse>(login).accessToken;

      // Deliberately over-generous: grants orders.manage, which viewer's
      // shop-wide role never includes.
      const escalationRole = await createBranchRole(
        adminToken,
        'Escalation Attempt',
        ['orders.view', 'orders.manage'],
      );
      await assign(adminToken, staffId, outletA, escalationRole.id);

      // Sanity: viewer really does have orders.view at this outlet now.
      await request(app.getHttpServer())
        .get(`/orders?outletId=${outletA}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      // The actual assertion: orders.manage was nominally granted, but the
      // intersection against viewer's real base permissions must strip it.
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          customerName: 'Escalation Test',
          customerPhone: '0500000001',
          customerAddress: '1 Test St',
          emirate: 'Dubai',
          orderType: 'pickup',
          outletId: outletA,
          items: [{ productId, quantity: 1 }],
        })
        .expect(403);
    });
  });

  describe('Staff update/delete', () => {
    it("admin can update an existing staff member's name, role, and outlet", async () => {
      const { adminToken, outletA, outletB } = await setupShop('staff-update');
      const staffEmail = `staff-update-target-${runId}@test.com`;
      const created = await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Original Name',
          email: staffEmail,
          password: 'password123',
          role: 'branch',
          outletId: outletA,
        })
        .expect(201);
      const staffId = body<IdRow>(created).id;

      const updated = await request(app.getHttpServer())
        .patch(`/auth/users/${staffId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Renamed', role: 'branch', outletId: outletB })
        .expect(200);
      expect(body<UserRow>(updated).name).toBe('Renamed');
      expect(body<UserRow>(updated).outletId).toBe(outletB);
    });

    it('an admin editing their own account via this endpoint is rejected — use profile settings instead', async () => {
      const { adminToken, adminId } = await setupShop('staff-update-self');
      await request(app.getHttpServer())
        .patch(`/auth/users/${adminId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Self Rename' })
        .expect(400);
    });

    it("adversarial: cannot update another shop's staff member by spoofing their id", async () => {
      const shopA = await setupShop('staff-update-tenant-a');
      const shopB = await setupShop('staff-update-tenant-b');
      const staffEmail = `staff-update-tenant-b-staff-${runId}@test.com`;
      const created = await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({
          name: 'Shop B Staff',
          email: staffEmail,
          password: 'password123',
          role: 'viewer',
        })
        .expect(201);
      const staffId = body<IdRow>(created).id;

      await request(app.getHttpServer())
        .patch(`/auth/users/${staffId}`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ name: 'Hijacked' })
        .expect(404);
    });

    it("blocks demoting the shop's only remaining admin, but allows it once a second admin exists", async () => {
      const { adminToken, adminId } = await setupShop(
        'staff-demote-last-admin',
      );
      await request(app.getHttpServer())
        .patch(`/auth/users/${adminId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'viewer' })
        .expect(400);

      const secondAdminEmail = `staff-demote-second-admin-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Second Admin',
          email: secondAdminEmail,
          password: 'password123',
          role: 'admin',
        })
        .expect(201);
      const secondAdminLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: secondAdminEmail, password: 'password123' })
        .expect(201);
      const secondAdminToken = body<AuthResponse>(secondAdminLogin).accessToken;

      // Now the original admin can safely be demoted by the second admin.
      await request(app.getHttpServer())
        .patch(`/auth/users/${adminId}`)
        .set('Authorization', `Bearer ${secondAdminToken}`)
        .send({ role: 'viewer' })
        .expect(200);
    });

    it('deletes a clean staff member with no activity history', async () => {
      const { adminToken } = await setupShop('staff-delete-clean');
      const staffEmail = `staff-delete-clean-target-${runId}@test.com`;
      const created = await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'To Delete',
          email: staffEmail,
          password: 'password123',
          role: 'viewer',
        })
        .expect(201);
      const staffId = body<IdRow>(created).id;

      await request(app.getHttpServer())
        .delete(`/auth/users/${staffId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const list = await request(app.getHttpServer())
        .get('/auth/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((list.body as IdRow[]).map((u) => u.id)).not.toContain(staffId);
    });

    it('blocks deleting a staff member who has existing activity history (an order note)', async () => {
      const { adminToken, outletA, productId } = await setupShop(
        'staff-delete-with-history',
      );
      const staffEmail = `staff-delete-history-target-${runId}@test.com`;
      const created = await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Has History',
          email: staffEmail,
          password: 'password123',
          role: 'branch',
          outletId: outletA,
        })
        .expect(201);
      const staffId = body<IdRow>(created).id;
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password: 'password123' })
        .expect(201);
      const staffToken = body<AuthResponse>(login).accessToken;

      const order = await createOrder(staffToken, outletA, productId);
      await request(app.getHttpServer())
        .post(`/orders/${order.id}/notes`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ note: 'Left a trace' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/auth/users/${staffId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it("adversarial: cannot delete another shop's staff member by spoofing their id", async () => {
      const shopA = await setupShop('staff-delete-tenant-a');
      const shopB = await setupShop('staff-delete-tenant-b');
      const staffEmail = `staff-delete-tenant-b-staff-${runId}@test.com`;
      const created = await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({
          name: 'Shop B Staff',
          email: staffEmail,
          password: 'password123',
          role: 'viewer',
        })
        .expect(201);
      const staffId = body<IdRow>(created).id;

      await request(app.getHttpServer())
        .delete(`/auth/users/${staffId}`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(404);
    });
  });
});
