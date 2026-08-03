import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import {
  basePermissionsFor,
  isPermission,
  type Permission,
} from '../common/permissions';
import { CreateBranchRoleDto } from './dto/create-branch-role.dto';
import { UpdateBranchRoleDto } from './dto/update-branch-role.dto';
import { AssignBranchRoleDto } from './dto/assign-branch-role.dto';

const ASSIGNMENT_INCLUDE = {
  user: { select: { id: true, name: true, email: true, role: true } },
  outlet: { select: { id: true, name: true } },
  branchrole: { select: { id: true, name: true, permissions: true } },
} satisfies Prisma.useroutletroleInclude;

@Injectable()
export class BranchRolesService {
  constructor(private readonly prisma: PrismaService) {}

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
    const override = await this.prisma.useroutletrole.findUnique({
      where: { userId_outletId: { userId: ctx.userId, outletId } },
      include: { branchrole: { select: { permissions: true } } },
    });
    if (!override) return null;

    const base = basePermissionsFor(ctx.role);
    const granted = this.parsePermissions(override.branchrole.permissions);
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

  private parsePermissions(raw: Prisma.JsonValue): Permission[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(isPermission);
  }

  // ---- branchrole bundle CRUD (admin-only, shop-scoped) ----

  async findAllRoles(ctx: TenantContext) {
    return this.prisma.branchrole.findMany({
      where: { shopId: ctx.shopId },
      orderBy: { id: 'asc' },
    });
  }

  async createRole(ctx: TenantContext, dto: CreateBranchRoleDto) {
    try {
      return await this.prisma.branchrole.create({
        data: {
          shopId: ctx.shopId,
          name: dto.name,
          permissions: dto.permissions,
        },
      });
    } catch (error) {
      this.handleRoleWriteError(error);
    }
  }

  async updateRole(ctx: TenantContext, id: number, dto: UpdateBranchRoleDto) {
    await this.assertRoleBelongsToShop(ctx, id);
    try {
      return await this.prisma.branchrole.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.permissions !== undefined && {
            permissions: dto.permissions,
          }),
        },
      });
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
    await this.prisma.branchrole.delete({ where: { id } });
    return { id, deleted: true };
  }

  private async assertRoleBelongsToShop(ctx: TenantContext, id: number) {
    const role = await this.prisma.branchrole.findFirst({
      where: { id, shopId: ctx.shopId },
    });
    if (!role) {
      throw new NotFoundException(`Branch role ${id} not found`);
    }
    return role;
  }

  private handleRoleWriteError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'A branch role with this name already exists',
      );
    }
    throw error;
  }

  // ---- assignment CRUD ----

  async listAssignments(ctx: TenantContext) {
    return this.prisma.useroutletrole.findMany({
      where: { user: { shopId: ctx.shopId } },
      include: ASSIGNMENT_INCLUDE,
      orderBy: { id: 'asc' },
    });
  }

  // Cross-tenant spoofing is exactly the class of bug this whole feature
  // exists to guard against catching again — userId, outletId, and
  // branchRoleId are each independently verified to belong to ctx.shopId
  // before the assignment is written, not just the outlet.
  async assign(ctx: TenantContext, dto: AssignBranchRoleDto) {
    const [user, outlet, role] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: dto.userId, shopId: ctx.shopId },
      }),
      this.prisma.outlet.findFirst({
        where: { id: dto.outletId, shopId: ctx.shopId },
      }),
      this.prisma.branchrole.findFirst({
        where: { id: dto.branchRoleId, shopId: ctx.shopId },
      }),
    ]);
    if (!user)
      throw new BadRequestException('User does not belong to this shop');
    if (!outlet)
      throw new BadRequestException('Outlet does not belong to this shop');
    if (!role)
      throw new BadRequestException('Branch role does not belong to this shop');

    return this.prisma.useroutletrole.upsert({
      where: {
        userId_outletId: { userId: dto.userId, outletId: dto.outletId },
      },
      create: {
        userId: dto.userId,
        outletId: dto.outletId,
        branchRoleId: dto.branchRoleId,
      },
      update: { branchRoleId: dto.branchRoleId },
      include: ASSIGNMENT_INCLUDE,
    });
  }

  async unassign(ctx: TenantContext, userId: number, outletId: number) {
    const existing = await this.prisma.useroutletrole.findFirst({
      where: { userId, outletId, user: { shopId: ctx.shopId } },
    });
    if (!existing) {
      throw new NotFoundException('Assignment not found');
    }
    await this.prisma.useroutletrole.delete({ where: { id: existing.id } });
    return { userId, outletId, deleted: true };
  }
}
