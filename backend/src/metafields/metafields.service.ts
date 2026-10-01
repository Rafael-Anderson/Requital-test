import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService, type QueryParam } from '../database/database.service';
import { isDuplicateKeyError } from '../database/mysql-errors';
import { AuditLogService } from '../audit-log/audit-log.service';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import { resolveOutletFilter } from '../common/outlet-scope';
import type { TenantContext, UserRole } from '../common/tenant-context';
import type { CreateMetafieldDefinitionDto } from './dto/create-metafield-definition.dto';
import type { UpdateMetafieldDefinitionDto } from './dto/update-metafield-definition.dto';
import type { SetMetafieldValuesDto } from './dto/set-metafield-values.dto';
import {
  MAX_DEFINITIONS_PER_OWNER_TYPE,
  MetafieldInvalid,
  NEVER_PUBLIC_OWNER_TYPES,
  normalizeValidationConfig,
  validateMetafieldValue,
  type MetafieldOwnerType,
  type MetafieldType,
  type ValidationConfig,
} from './metafield-types';

interface DefinitionRow extends RowDataPacket {
  id: number;
  shopId: number;
  ownerType: MetafieldOwnerType;
  namespace: string;
  fieldKey: string;
  name: string;
  type: MetafieldType;
  validationJson: ValidationConfig | null;
  displayOrder: number;
  visibleOnStorefront: boolean;
}

const ALL_ROLES: UserRole[] = ['admin', 'branch', 'order_manager', 'viewer'];

// Who may read / write the values hanging off each owner type. Mirrors, one
// for one, the role lists on the owner's own controller (products/collections:
// reads open, writes admin; customers: admin+viewer read, admin write; orders:
// the orders controller's lists; outlets: reads open with branch pinned to its
// own outlet, writes admin). No new vocabulary: a value is exactly as
// editable as the thing it hangs off.
const ACCESS: Record<
  MetafieldOwnerType,
  { read: UserRole[]; write: UserRole[] }
> = {
  product: { read: ALL_ROLES, write: ['admin'] },
  variant: { read: ALL_ROLES, write: ['admin'] },
  collection: { read: ALL_ROLES, write: ['admin'] },
  customer: { read: ['admin', 'viewer'], write: ['admin'] },
  order: {
    read: ALL_ROLES,
    write: ['admin', 'branch', 'order_manager'],
  },
  outlet: { read: ALL_ROLES, write: ['admin'] },
};

// Plain read of "does this owner exist in THIS shop". The shopId predicate is
// the IDOR guard: another shop's id is indistinguishable from a missing one.
const OWNER_LOOKUP: Record<MetafieldOwnerType, string> = {
  product: `SELECT id, NULL AS outletId FROM product WHERE id = ? AND shopId = ?`,
  variant: `SELECT v.id, NULL AS outletId FROM productvariant v JOIN product p ON p.id = v.productId WHERE v.id = ? AND p.shopId = ?`,
  collection: `SELECT id, NULL AS outletId FROM collection WHERE id = ? AND shopId = ?`,
  customer: `SELECT id, NULL AS outletId FROM customer WHERE id = ? AND shopId = ?`,
  order: `SELECT id, outletId FROM \`order\` WHERE id = ? AND shopId = ?`,
  outlet: `SELECT id, id AS outletId FROM outlet WHERE id = ? AND shopId = ?`,
};

function toDefinition(d: DefinitionRow) {
  return {
    id: d.id,
    ownerType: d.ownerType,
    namespace: d.namespace,
    key: d.fieldKey,
    name: d.name,
    type: d.type,
    validation: d.validationJson ?? null,
    displayOrder: d.displayOrder,
    visibleOnStorefront: d.visibleOnStorefront,
  };
}

function invalid(e: unknown): never {
  if (e instanceof MetafieldInvalid) throw new BadRequestException(e.message);
  throw e;
}

// Batch-loads the STOREFRONT-VISIBLE metafield values of a list of products in
// ONE query and returns them keyed by product id as { "namespace.key": value }.
// A plain function taking the db so PublicService can call it without a new
// constructor dependency. shopId is checked on both the value and the
// definition, and visibleOnStorefront is part of the WHERE: a hidden field is
// never selected at all, so it cannot leak through any later spread.
export async function loadVisibleProductMetafields(
  db: DatabaseService,
  shopId: number,
  productIds: number[],
): Promise<Map<number, Record<string, unknown>>> {
  const out = new Map<number, Record<string, unknown>>();
  if (productIds.length === 0) return out;
  const rows = await db.query<RowDataPacket[]>(
    `SELECT v.ownerId, d.namespace, d.fieldKey, v.value
       FROM metafieldvalue v
       JOIN metafielddefinition d ON d.id = v.definitionId
      WHERE v.ownerType = 'product' AND d.ownerType = 'product'
        AND v.shopId = ? AND d.shopId = ?
        AND d.visibleOnStorefront = 1
        AND v.ownerId IN (${productIds.map(() => '?').join(', ')})
      ORDER BY d.displayOrder ASC, d.id ASC`,
    [shopId, shopId, ...productIds],
  );
  for (const r of rows) {
    const id = r.ownerId as number;
    const bag = out.get(id) ?? {};
    bag[`${r.namespace as string}.${r.fieldKey as string}`] = r.value;
    out.set(id, bag);
  }
  return out;
}

@Injectable()
export class MetafieldsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly branchRolesService: BranchRolesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ---- definitions (admin writes; reads open to any authenticated role) ----

  async listDefinitions(ctx: TenantContext, ownerType?: MetafieldOwnerType) {
    const rows = await this.db.query<DefinitionRow[]>(
      `SELECT * FROM metafielddefinition WHERE shopId = ?${ownerType ? ' AND ownerType = ?' : ''}
       ORDER BY ownerType ASC, displayOrder ASC, id ASC`,
      ownerType ? [ctx.shopId, ownerType] : [ctx.shopId],
    );
    return rows.map(toDefinition);
  }

  private async findDefinition(ctx: TenantContext, id: number) {
    const rows = await this.db.query<DefinitionRow[]>(
      `SELECT * FROM metafielddefinition WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (!rows[0]) throw new NotFoundException(`Custom field ${id} not found`);
    return rows[0];
  }

  async createDefinition(
    ctx: TenantContext,
    dto: CreateMetafieldDefinitionDto,
  ) {
    const ownerType = dto.ownerType as MetafieldOwnerType;
    const type = dto.type as MetafieldType;
    if (
      dto.visibleOnStorefront &&
      NEVER_PUBLIC_OWNER_TYPES.includes(ownerType)
    ) {
      throw new BadRequestException(
        `${ownerType} custom fields hold personal data and cannot be shown on the storefront`,
      );
    }
    let validation: ValidationConfig | null;
    try {
      validation = normalizeValidationConfig(type, dto.validation);
    } catch (e) {
      invalid(e);
    }
    const countRows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM metafielddefinition WHERE shopId = ? AND ownerType = ?`,
      [ctx.shopId, ownerType],
    );
    if (Number(countRows[0].c) >= MAX_DEFINITIONS_PER_OWNER_TYPE) {
      throw new ConflictException(
        `A shop can have at most ${MAX_DEFINITIONS_PER_OWNER_TYPE} custom fields per record type`,
      );
    }
    let id: number;
    try {
      const res = await this.db.execute(
        `INSERT INTO metafielddefinition
           (shopId, ownerType, namespace, fieldKey, name, type, validationJson, displayOrder, visibleOnStorefront)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx.shopId,
          ownerType,
          dto.namespace,
          dto.key,
          dto.name,
          type,
          validation ? JSON.stringify(validation) : null,
          dto.displayOrder ?? 0,
          dto.visibleOnStorefront ?? false,
        ],
      );
      id = res.insertId;
    } catch (e) {
      if (isDuplicateKeyError(e)) {
        throw new ConflictException(
          `A ${ownerType} custom field "${dto.namespace}.${dto.key}" already exists`,
        );
      }
      throw e;
    }
    const def = toDefinition(await this.findDefinition(ctx, id));
    await this.auditLogService.logCtx(ctx, {
      action: 'metafield_definition.created',
      entityType: 'metafield_definition',
      entityId: id,
      after: def,
    });
    return def;
  }

  async updateDefinition(
    ctx: TenantContext,
    id: number,
    dto: UpdateMetafieldDefinitionDto,
  ) {
    const existing = await this.findDefinition(ctx, id);
    if (
      dto.visibleOnStorefront &&
      NEVER_PUBLIC_OWNER_TYPES.includes(existing.ownerType)
    ) {
      throw new BadRequestException(
        `${existing.ownerType} custom fields hold personal data and cannot be shown on the storefront`,
      );
    }
    let validation: ValidationConfig | null | undefined;
    if (dto.validation !== undefined) {
      try {
        validation = normalizeValidationConfig(existing.type, dto.validation);
      } catch (e) {
        invalid(e);
      }
      // Tightening a rule or removing a select option must never leave a
      // stored value that the new rule would have rejected. Every stored value
      // is re-checked; if any fails, the edit is refused (409) rather than
      // silently corrupting data or silently deleting it.
      const stored = await this.db.query<RowDataPacket[]>(
        `SELECT ownerId, value FROM metafieldvalue WHERE definitionId = ? AND shopId = ?`,
        [id, ctx.shopId],
      );
      const bad = stored.filter((r) => {
        try {
          validateMetafieldValue(existing.type, validation ?? null, r.value);
          return false;
        } catch {
          return true;
        }
      });
      if (bad.length > 0) {
        throw new ConflictException(
          `${bad.length} existing value${bad.length === 1 ? '' : 's'} would no longer be valid under these settings. Edit or clear them first.`,
        );
      }
    }
    const sets: string[] = [];
    const params: QueryParam[] = [];
    if (dto.name !== undefined) {
      sets.push('name = ?');
      params.push(dto.name);
    }
    if (dto.validation !== undefined) {
      sets.push('validationJson = ?');
      params.push(validation ? JSON.stringify(validation) : null);
    }
    if (dto.displayOrder !== undefined) {
      sets.push('displayOrder = ?');
      params.push(dto.displayOrder);
    }
    if (dto.visibleOnStorefront !== undefined) {
      sets.push('visibleOnStorefront = ?');
      params.push(dto.visibleOnStorefront);
    }
    if (sets.length > 0) {
      await this.db.execute(
        `UPDATE metafielddefinition SET ${sets.join(', ')}, updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ? AND shopId = ?`,
        [...params, id, ctx.shopId],
      );
    }
    const after = toDefinition(await this.findDefinition(ctx, id));
    await this.auditLogService.logCtx(ctx, {
      action: 'metafield_definition.updated',
      entityType: 'metafield_definition',
      entityId: id,
      before: toDefinition(existing),
      after,
    });
    return after;
  }

  // A definition that still has values is protected: the delete is a 409 that
  // says how many values would go. `deleteValues` is the explicit opt-in, and
  // the values are removed in the SAME transaction as the definition.
  async removeDefinition(
    ctx: TenantContext,
    id: number,
    deleteValues: boolean,
  ) {
    const existing = await this.findDefinition(ctx, id);
    const removed = await this.db.transaction(async (conn) => {
      const [countRows] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM metafieldvalue WHERE definitionId = ? AND shopId = ?`,
        [id, ctx.shopId],
      );
      const valueCount = Number(countRows[0].c);
      if (valueCount > 0 && !deleteValues) {
        throw new ConflictException(
          `${valueCount} value${valueCount === 1 ? ' is' : 's are'} stored under this custom field. Delete it with deleteValues=true to remove them too.`,
        );
      }
      await conn.query(
        `DELETE FROM metafieldvalue WHERE definitionId = ? AND shopId = ?`,
        [id, ctx.shopId],
      );
      await conn.query(
        `DELETE FROM metafielddefinition WHERE id = ? AND shopId = ?`,
        [id, ctx.shopId],
      );
      return valueCount;
    });
    await this.auditLogService.logCtx(ctx, {
      action: 'metafield_definition.deleted',
      entityType: 'metafield_definition',
      entityId: id,
      before: toDefinition(existing),
      metadata: { valuesDeleted: removed },
    });
    return { id, deleted: true, valuesDeleted: removed };
  }

  // ---- values ----

  // Resolves the owner inside the caller's shop and applies the owner's own
  // role/outlet rules. Returns the owner's outletId (orders/outlets only).
  private async assertOwnerAccess(
    ctx: TenantContext,
    ownerType: MetafieldOwnerType,
    ownerId: number,
    action: 'read' | 'write',
  ): Promise<void> {
    if (!ACCESS[ownerType][action].includes(ctx.role)) {
      throw new ForbiddenException(
        `Your role cannot ${action} ${ownerType} custom fields`,
      );
    }
    const rows = await this.db.query<RowDataPacket[]>(OWNER_LOOKUP[ownerType], [
      ownerId,
      ctx.shopId,
    ]);
    const owner = rows[0];
    if (!owner) {
      throw new NotFoundException(`${ownerType} ${ownerId} not found`);
    }
    if (ownerType === 'order' || ownerType === 'outlet') {
      // A branch user is pinned to its own outlet: anything else is a 404,
      // never a substitution (see resolveOutletFilter / outlets.findOne).
      const pinned = resolveOutletFilter(ctx, undefined);
      const outletId = owner.outletId as number;
      if (pinned !== undefined && outletId !== pinned) {
        throw new NotFoundException(`${ownerType} ${ownerId} not found`);
      }
      if (ctx.role === 'branch') {
        const permission =
          ownerType === 'outlet'
            ? 'outlets.view_own'
            : action === 'read'
              ? 'orders.view'
              : 'orders.manage';
        await this.branchRolesService.assertPermission(
          ctx,
          outletId,
          permission,
        );
      }
    }
  }

  async getValues(
    ctx: TenantContext,
    ownerType: MetafieldOwnerType,
    ownerId: number,
  ) {
    await this.assertOwnerAccess(ctx, ownerType, ownerId, 'read');
    return this.assemble(ctx.shopId, ownerType, ownerId);
  }

  // Every definition for the owner type, each with this owner's value (or
  // null). Two queries regardless of how many definitions exist.
  private async assemble(
    shopId: number,
    ownerType: MetafieldOwnerType,
    ownerId: number,
  ) {
    const [defs, values] = await Promise.all([
      this.db.query<DefinitionRow[]>(
        `SELECT * FROM metafielddefinition WHERE shopId = ? AND ownerType = ? ORDER BY displayOrder ASC, id ASC`,
        [shopId, ownerType],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT definitionId, value FROM metafieldvalue WHERE shopId = ? AND ownerType = ? AND ownerId = ?`,
        [shopId, ownerType, ownerId],
      ),
    ]);
    const byDef = new Map<number, unknown>(
      values.map((v) => [v.definitionId as number, v.value as unknown]),
    );
    return defs.map((d) => ({
      ...toDefinition(d),
      value: byDef.has(d.id) ? byDef.get(d.id) : null,
    }));
  }

  async setValues(
    ctx: TenantContext,
    ownerType: MetafieldOwnerType,
    ownerId: number,
    dto: SetMetafieldValuesDto,
  ) {
    // Owner first: nothing about the definitions is touched until the owner is
    // proven to belong to the caller's shop and the caller may write it.
    await this.assertOwnerAccess(ctx, ownerType, ownerId, 'write');

    const ids = dto.values.map((v) => v.definitionId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Each custom field can appear only once');
    }
    const defs =
      ids.length === 0
        ? []
        : await this.db.query<DefinitionRow[]>(
            `SELECT * FROM metafielddefinition WHERE shopId = ? AND id IN (${ids.map(() => '?').join(', ')})`,
            [ctx.shopId, ...ids],
          );
    const defById = new Map(defs.map((d) => [d.id, d]));

    // Validate everything before writing anything.
    const upserts: { definitionId: number; value: unknown }[] = [];
    const removals: number[] = [];
    for (const input of dto.values) {
      const def = defById.get(input.definitionId);
      if (!def) {
        throw new NotFoundException(
          `Custom field ${input.definitionId} not found`,
        );
      }
      if (def.ownerType !== ownerType) {
        throw new BadRequestException(
          `Custom field ${def.id} belongs to ${def.ownerType} records, not ${ownerType}`,
        );
      }
      if (input.value === null || input.value === undefined) {
        removals.push(def.id);
        continue;
      }
      try {
        upserts.push({
          definitionId: def.id,
          value: validateMetafieldValue(
            def.type,
            def.validationJson,
            input.value,
          ),
        });
      } catch (e) {
        if (e instanceof MetafieldInvalid) {
          throw new BadRequestException(`${def.name}: ${e.message}`);
        }
        throw e;
      }
    }

    await this.db.transaction(async (conn) => {
      for (const u of upserts) {
        await conn.query(
          `INSERT INTO metafieldvalue (shopId, ownerType, ownerId, definitionId, value)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE value = VALUES(value), updatedAt = CURRENT_TIMESTAMP(3)`,
          [
            ctx.shopId,
            ownerType,
            ownerId,
            u.definitionId,
            JSON.stringify(u.value),
          ],
        );
      }
      if (removals.length > 0) {
        await conn.query(
          `DELETE FROM metafieldvalue WHERE ownerType = ? AND ownerId = ? AND shopId = ? AND definitionId IN (${removals.map(() => '?').join(', ')})`,
          [ownerType, ownerId, ctx.shopId, ...removals],
        );
      }
    });
    // Definition ids only: a customer value is personal data, so it is never
    // copied into the audit log.
    await this.auditLogService.logCtx(ctx, {
      action: 'metafield_values.set',
      entityType: ownerType,
      entityId: ownerId,
      metadata: {
        set: upserts.map((u) => u.definitionId),
        cleared: removals,
      },
    });
    return this.assemble(ctx.shopId, ownerType, ownerId);
  }
}

// PDPL export: every custom-field value this shop holds on the customer,
// regardless of storefront visibility (it is the customer's own data). A plain
// function so CustomerAccountService needs no new constructor dependency.
export async function exportCustomerMetafields(
  db: DatabaseService,
  shopId: number,
  customerId: number,
) {
  const rows = await db.query<RowDataPacket[]>(
    `SELECT d.namespace, d.fieldKey, d.name, v.value
       FROM metafieldvalue v
       JOIN metafielddefinition d ON d.id = v.definitionId AND d.shopId = v.shopId
      WHERE v.shopId = ? AND v.ownerType = 'customer' AND v.ownerId = ?
      ORDER BY d.displayOrder ASC, d.id ASC`,
    [shopId, customerId],
  );
  return rows.map((r) => ({
    key: `${r.namespace as string}.${r.fieldKey as string}`,
    name: r.name as string,
    value: r.value as unknown,
  }));
}
