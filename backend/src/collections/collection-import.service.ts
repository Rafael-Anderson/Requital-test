import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { isDuplicateKeyError } from '../database/mysql-errors';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { TenantContext } from '../common/tenant-context';
import { readTable } from '../common/table-file';
import {
  CollectionColumnsError,
  MAX_COLLECTION_ROWS,
  creationOrder,
  parseCollectionRows,
  planCollectionImport,
  type CollectionPlanRow,
  type ExistingCollection,
  type OnExisting,
} from './collection-import';

const REPORT_ROW_CAP = 1_000;
const SELECT_ALL = `SELECT id, name, slug, parentCollectionId, description, image
                      FROM collection WHERE shopId = ?`;

export interface CollectionImportReport {
  source: 'collections';
  onExisting: OnExisting;
  totals: {
    rows: number;
    create: number;
    update: number;
    skip: number;
    error: number;
  };
  rows: Omit<
    CollectionPlanRow,
    'key' | 'existingId' | 'newSlug' | 'parentKey' | 'set'
  >[];
  truncated: boolean;
  warnings: string[];
  unsupportedColumns: string[];
}

// ONB-1: collections import. Preview reads and writes nothing. Confirm
// re-uploads the same file, re-reads the shop's collections UNDER A ROW LOCK
// (so a concurrent edit cannot make the plan stale between plan and write),
// re-plans from the bytes and writes in one transaction. The preview is never
// an input to confirm.
@Injectable()
export class CollectionImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async preview(
    ctx: TenantContext,
    file: Express.Multer.File,
    onExisting: OnExisting = 'skip',
  ): Promise<CollectionImportReport> {
    const parsed = this.parse(file);
    const existing = await this.db.query<
      (ExistingCollection & RowDataPacket)[]
    >(SELECT_ALL, [ctx.shopId]);
    return this.report(
      parsed,
      planCollectionImport(parsed.rows, existing, onExisting),
      onExisting,
    );
  }

  async confirm(
    ctx: TenantContext,
    file: Express.Multer.File,
    onExisting: OnExisting = 'skip',
  ) {
    const parsed = this.parse(file);
    let report!: CollectionImportReport;
    try {
      await this.db.transaction(async (conn) => {
        const [existing] = await conn.query<
          (ExistingCollection & RowDataPacket)[]
        >(`${SELECT_ALL} FOR UPDATE`, [ctx.shopId]);
        const plans = planCollectionImport(parsed.rows, existing, onExisting);
        report = this.report(parsed, plans, onExisting);

        const [maxRows] = await conn.query<RowDataPacket[]>(
          `SELECT COALESCE(MAX(displayOrder), 0) AS m FROM collection WHERE shopId = ?`,
          [ctx.shopId],
        );
        let order = Number(maxRows[0].m) + 1;
        const idByKey = new Map<string, number>();
        const resolveKey = (key: string | null | undefined): number | null => {
          if (!key) return null;
          if (key.startsWith('e:')) return Number(key.slice(2));
          return idByKey.get(key) ?? null;
        };

        for (const plan of creationOrder(plans)) {
          const [result] = await conn.query<
            RowDataPacket[] & { insertId: number }
          >(
            `INSERT INTO collection (shopId, name, slug, parentCollectionId, displayOrder, image, isFeatured, description)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
            [
              ctx.shopId,
              plan.set.name,
              plan.newSlug,
              resolveKey(plan.parentKey),
              order,
              plan.set.image ?? null,
              plan.set.description ?? null,
            ],
          );
          order += 1;
          idByKey.set(
            plan.key,
            (result as unknown as { insertId: number }).insertId,
          );
        }

        for (const plan of plans.filter((p) => p.action === 'update')) {
          const sets: string[] = [];
          const params: (string | number | null)[] = [];
          for (const col of ['name', 'description', 'image'] as const) {
            const value = plan.set[col];
            if (value !== undefined) {
              sets.push(`${col} = ?`);
              params.push(value);
            }
          }
          if (plan.parentKey !== undefined) {
            sets.push('parentCollectionId = ?');
            params.push(resolveKey(plan.parentKey));
          }
          if (sets.length === 0) continue;
          await conn.query(
            `UPDATE collection SET ${sets.join(', ')} WHERE id = ? AND shopId = ?`,
            [...params, plan.existingId, ctx.shopId],
          );
        }
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'A collection with the same slug was created while this import ran. Run the preview again.',
        );
      }
      throw error;
    }

    // Counts only.
    await this.auditLogService.logCtx(ctx, {
      action: 'collection.imported',
      entityType: 'collection',
      metadata: {
        created: report.totals.create,
        updated: report.totals.update,
        skipped: report.totals.skip,
        errors: report.totals.error,
      },
    });
    return {
      created: report.totals.create,
      updated: report.totals.update,
      skipped: report.totals.skip,
      errors: report.totals.error,
      report,
    };
  }

  private parse(file: Express.Multer.File) {
    const table = readTable(file, { allowXlsx: true });
    if (table.rows.length === 0) {
      throw new BadRequestException('The file has no collection rows');
    }
    if (table.rows.length > MAX_COLLECTION_ROWS) {
      throw new BadRequestException(
        `A collections import can have at most ${MAX_COLLECTION_ROWS} rows`,
      );
    }
    try {
      return parseCollectionRows(table.rows, table.headers);
    } catch (error) {
      if (error instanceof CollectionColumnsError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private report(
    parsed: ReturnType<typeof parseCollectionRows>,
    plans: CollectionPlanRow[],
    onExisting: OnExisting,
  ): CollectionImportReport {
    const count = (a: CollectionPlanRow['action']) =>
      plans.filter((p) => p.action === a).length;
    const visible = [
      ...plans.filter((p) => p.action === 'error'),
      ...plans.filter((p) => p.action !== 'error'),
    ].map((p) => ({
      rowNumber: p.rowNumber,
      name: p.name,
      action: p.action,
      reason: p.reason,
      changes: p.changes,
      warnings: p.warnings,
      errors: p.errors,
      depth: p.depth,
    }));
    return {
      source: 'collections',
      onExisting,
      totals: {
        rows: plans.length,
        create: count('create'),
        update: count('update'),
        skip: count('skip'),
        error: count('error'),
      },
      rows: visible.slice(0, REPORT_ROW_CAP),
      truncated: visible.length > REPORT_ROW_CAP,
      warnings: [],
      unsupportedColumns: parsed.unsupportedColumns,
    };
  }
}
