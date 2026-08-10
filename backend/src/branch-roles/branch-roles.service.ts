import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { upsert } from '../database/upsert.util';
import { isDuplicateKeyError } from '../database/mysql-errors';
import { buildSetClause } from '../database/update.util';
import type { RowDataPacket } from 'mysql2/promise';
import type { TenantContext } from '../common/tenant-context';
import {
  basePermissionsFor,
  isPermission,
  type Permission,
} from '../common/permissions';
import { CreateBranchRoleDto } from './dto/create-branch-role.dto';
import { UpdateBranchRoleDto } from './dto/update-branch-role.dto';
import { AssignBranchRoleDto } from './dto/assign-branch-role.dto';

@Injectable()
export class BranchRolesService {
  constructor(private readonly db: DatabaseService) {}

  // The layer-on-top mechanism every outlet-scoped module calls before
  // falling back to its existing ctx.role logic. A null return means "no
  // useroutletrole row for this (user, outlet) — behave exactly as today,"
  // which is what makes this purely additive: a shop that never assigns an
  // override sees zero behavior change anywhere.
  //
  // When an override DOES exist, the returned set is
  // intersection(basePermissionsFor(ctx.role), branchrole.permissions) —
  // this intersection, not the assignment UI, is what structurally
  // guarantees restrict-only: no possible assignment (even a careless or
  // API-spoofed one) can grant a user more than their existing shop-wide
  // role already permits, because anything the branchrole grants that
  // isn't already in the base role's set is simply dropped.
  async resolveEffectivePermissions(
    ctx: TenantContext,
    outletId: number,
  ): Promise<Set<Permission> | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT br.permissions
       FROM useroutletrole uor
       JOIN branchrole br ON br.id = uor.branchRoleId
       WHERE uor.userId = ? AND uor.outletId = ?`,
      [ctx.userId, outletId],
    );
    if (rows.length === 0) return null;

    const base = basePermissionsFor(ctx.role);
    const granted = this.parsePermissions(rows[0].permissions as unknown);
    const effective = new Set<Permission>();
    for (const permission of granted) {
      if (base.has(permission)) effective.add(permission);
    }
    return effective;
  }

  // Thin wrapper every call site actually invokes: resolves the effective
  // set and throws only when an override exists AND lacks the required
  // permission. A null (no override) always passes through untouched.
  async assertPermission(
    ctx: TenantContext,
    outletId: number,
    required: Permission,
  ): Promise<void> {
    const effective = await this.resolveEffectivePermissions(ctx, outletId);
    if (effective && !effective.has(required)) {
      throw new ForbiddenException(
        `Missing permission '${required}' at this outlet`,
      );
    }
  }

  private parsePermissions(raw: unknown): Permission[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(isPermission);
  }

  // ---- branchrole bundle CRUD (admin-only, shop-scoped) ----

  async findAllRoles(ctx: TenantContext) {
    return this.db.query<RowDataPacket[]>(
      `SELECT * FROM branchrole WHERE shopId = ? ORDER BY id ASC`,
      [ctx.shopId],
    );
  }

  async createRole(ctx: TenantContext, dto: CreateBranchRoleDto) {
    try {
      const result = await this.db.execute(
        `INSERT INTO branchrole (shopId, name, permissions) VALUES (?, ?, ?)`,
        [ctx.shopId, dto.name, JSON.stringify(dto.permissions)],
      );
      return this.findRoleById(result.insertId);
    } catch (error) {
      this.handleRoleWriteError(error);
    }
  }

  async updateRole(ctx: TenantContext, id: number, dto: UpdateBranchRoleDto) {
    await this.assertRoleBelongsToShop(ctx, id);
    try {
      const set = buildSetClause({
        name: dto.name,
        permissions:
          dto.permissions !== undefined ? JSON.stringify(dto.permissions) : undefined,
      });
      if (set) {
        await this.db.execute(`UPDATE branchrole SET ${set.setClause} WHERE id = ?`, [
          ...set.params,
          id,
        ]);
      }
      return this.findRoleById(id);
    } catch (error) {
      this.handleRoleWriteError(error);
    }
  }

  // Cascades to any useroutletrole rows pointing at this role (see the
  // schema's onDelete: Cascade) — an assignment referencing a deleted role
  // definition is meaningless, so removing it along with the role is
  // correct, not a gap. Unlike ingredientcategory's delete-blocked-if-
  // referenced pattern, there's nothing worth preserving here.
  async removeRole(ctx: TenantContext, id: number) {
    await this.assertRoleBelongsToShop(ctx, id);
    await this.db.execute(`DELETE FROM branchrole WHERE id = ?`, [id]);
    return { id, deleted: true };
  }

  private async findRoleById(id: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM branchrole WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  private async assertRoleBelongsToShop(ctx: TenantContext, id: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM branchrole WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (!rows[0]) {
      throw new NotFoundException(`Branch role ${id} not found`);
    }
    return rows[0];
  }

  private handleRoleWriteError(error: unknown): never {
    if (isDuplicateKeyError(error)) {
      throw new ConflictException(
        'A branch role with this name already exists',
      );
    }
    throw error;
  }

  // ---- assignment CRUD ----

  async listAssignments(ctx: TenantContext) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT uor.id, uor.userId, uor.outletId, uor.branchRoleId, uor.createdAt,
              u.id AS userJoinId, u.name AS userName, u.email AS userEmail, u.role AS userRole,
              o.id AS outletJoinId, o.name AS outletName,
              br.id AS branchRoleJoinId, br.name AS branchRoleName, br.permissions AS branchRolePermissions
       FROM useroutletrole uor
       JOIN user u ON u.id = uor.userId
       JOIN outlet o ON o.id = uor.outletId
       JOIN branchrole br ON br.id = uor.branchRoleId
       WHERE u.shopId = ?
       ORDER BY uor.id ASC`,
      [ctx.shopId],
    );
    return rows.map((r) => this.rowToAssignment(r));
  }

  // Cross-tenant spoofing is exactly the class of bug this whole feature
  // exists to guard against catching again — userId, outletId, and
  // branchRoleId are each independently verified to belong to ctx.shopId
  // before the assignment is written, not just the outlet.
  async assign(ctx: TenantContext, dto: AssignBranchRoleDto) {
    const [userRows, outletRows, roleRows] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT id FROM user WHERE id = ? AND shopId = ?`,
        [dto.userId, ctx.shopId],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
        [dto.outletId, ctx.shopId],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT id FROM branchrole WHERE id = ? AND shopId = ?`,
        [dto.branchRoleId, ctx.shopId],
      ),
    ]);
    if (userRows.length === 0)
      throw new BadRequestException('User does not belong to this shop');
    if (outletRows.length === 0)
      throw new BadRequestException('Outlet does not belong to this shop');
    if (roleRows.length === 0)
      throw new BadRequestException('Branch role does not belong to this shop');

    await upsert(
      this.db.pool,
      'useroutletrole',
      { userId: dto.userId, outletId: dto.outletId, branchRoleId: dto.branchRoleId },
      ['branchRoleId'],
    );
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT uor.id, uor.userId, uor.outletId, uor.branchRoleId, uor.createdAt,
              u.id AS userJoinId, u.name AS userName, u.email AS userEmail, u.role AS userRole,
              o.id AS outletJoinId, o.name AS outletName,
              br.id AS branchRoleJoinId, br.name AS branchRoleName, br.permissions AS branchRolePermissions
       FROM useroutletrole uor
       JOIN user u ON u.id = uor.userId
       JOIN outlet o ON o.id = uor.outletId
       JOIN branchrole br ON br.id = uor.branchRoleId
       WHERE uor.userId = ? AND uor.outletId = ?`,
      [dto.userId, dto.outletId],
    );
    return this.rowToAssignment(rows[0]);
  }

  async unassign(ctx: TenantContext, userId: number, outletId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT uor.id FROM useroutletrole uor
       JOIN user u ON u.id = uor.userId
       WHERE uor.userId = ? AND uor.outletId = ? AND u.shopId = ?`,
      [userId, outletId, ctx.shopId],
    );
    if (!rows[0]) {
      throw new NotFoundException('Assignment not found');
    }
    await this.db.execute(`DELETE FROM useroutletrole WHERE id = ?`, [rows[0].id]);
    return { userId, outletId, deleted: true };
  }

  private rowToAssignment(r: RowDataPacket) {
    return {
      id: r.id as number,
      userId: r.userId as number,
      outletId: r.outletId as number,
      branchRoleId: r.branchRoleId as number,
      createdAt: r.createdAt as Date,
      user: {
        id: r.userJoinId as number,
        name: r.userName as string,
        email: r.userEmail as string,
        role: r.userRole as string,
      },
      outlet: { id: r.outletJoinId as number, name: r.outletName as string },
      branchrole: {
        id: r.branchRoleJoinId as number,
        name: r.branchRoleName as string,
        permissions: r.branchRolePermissions,
      },
    };
  }
}
