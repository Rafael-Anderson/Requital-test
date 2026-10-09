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
  CustomerColumnsError,
  MAX_CUSTOMER_ROWS,
  normaliseCustomerPhone,
  parseCustomerRows,
  planCustomerImport,
  type CustomerPlanRow,
  type ExistingCustomer,
} from './customer-import';

const REPORT_ROW_CAP = 1_000;
const IN_CHUNK = 500;

export interface CustomerImportReport {
  source: 'customers';
  onExisting: 'update' | 'skip';
  totals: {
    rows: number;
    create: number;
    update: number;
    skip: number;
    conflict: number;
    error: number;
  };
  rows: Pick<
    CustomerPlanRow,
    | 'rowNumber'
    | 'name'
    | 'phoneMasked'
    | 'action'
    | 'reason'
    | 'changes'
    | 'warnings'
    | 'errors'
  >[];
  truncated: boolean;
  warnings: string[];
  unsupportedColumns: string[];
  note: string;
}

const NOTE =
  'Imported customers are not subscribed to anything and no email or message is sent to them.';

// ONB-1: customers import. See customer-import.ts for the phone rule. Preview
// writes nothing; confirm re-uploads and re-plans from the bytes (the preview
// is never an input) and writes in one transaction. Every query is scoped by
// ctx.shopId. No consent field is written and nothing is queued.
@Injectable()
export class CustomerImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async preview(
    ctx: TenantContext,
    file: Express.Multer.File,
    onExisting: 'update' | 'skip' = 'skip',
  ): Promise<CustomerImportReport> {
    const { parsed, plans } = await this.plan(ctx, file, onExisting);
    return this.report(parsed, plans, onExisting);
  }

  async confirm(
    ctx: TenantContext,
    file: Express.Multer.File,
    onExisting: 'update' | 'skip' = 'skip',
  ) {
    const { parsed, plans } = await this.plan(ctx, file, onExisting);
    const report = this.report(parsed, plans, onExisting);
    try {
      await this.db.transaction(async (conn) => {
        for (const p of plans) {
          if (p.action === 'create') {
            await conn.query(
              `INSERT INTO customer (shopId, name, phone, email, addresses) VALUES (?, ?, ?, ?, ?)`,
              [
                ctx.shopId,
                p.name,
                p.phone,
                p.setEmail,
                p.addAddress ? JSON.stringify([p.addAddress]) : null,
              ],
            );
          } else if (p.action === 'update') {
            if (p.setEmail !== null) {
              // Only fills an empty email: a value set meanwhile is not overwritten.
              await conn.query(
                `UPDATE customer SET email = ? WHERE id = ? AND shopId = ? AND email IS NULL`,
                [p.setEmail, p.existingId, ctx.shopId],
              );
            }
            if (p.addAddress) {
              // Read-modify-write of the JSON array under a row lock.
              const [rows] = await conn.query<RowDataPacket[]>(
                `SELECT addresses FROM customer WHERE id = ? AND shopId = ? FOR UPDATE`,
                [p.existingId, ctx.shopId],
              );
              const list = (
                (rows[0]?.addresses as unknown[] | null) ?? []
              ).slice();
              list.push(p.addAddress);
              await conn.query(
                `UPDATE customer SET addresses = ? WHERE id = ? AND shopId = ?`,
                [JSON.stringify(list), p.existingId, ctx.shopId],
              );
            }
          }
        }
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'A customer with the same phone number was created while this import ran. Run the preview again.',
        );
      }
      throw error;
    }

    // Counts only: no names, phones or emails.
    await this.auditLogService.logCtx(ctx, {
      action: 'customer.imported',
      entityType: 'customer',
      metadata: {
        created: report.totals.create,
        updated: report.totals.update,
        skipped: report.totals.skip,
        conflicts: report.totals.conflict,
        errors: report.totals.error,
      },
    });
    return {
      created: report.totals.create,
      updated: report.totals.update,
      skipped: report.totals.skip,
      conflicts: report.totals.conflict,
      errors: report.totals.error,
      report,
    };
  }

  private async plan(
    ctx: TenantContext,
    file: Express.Multer.File,
    onExisting: 'update' | 'skip',
  ) {
    const table = readTable(file, { allowXlsx: true });
    if (table.rows.length === 0) {
      throw new BadRequestException('The file has no customer rows');
    }
    if (table.rows.length > MAX_CUSTOMER_ROWS) {
      throw new BadRequestException(
        `A customers import can have at most ${MAX_CUSTOMER_ROWS} rows`,
      );
    }
    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT countryCode FROM shop WHERE id = ?`,
      [ctx.shopId],
    );
    const countryCode = (shopRows[0]?.countryCode as string | null) ?? null;

    let parsed: ReturnType<typeof parseCustomerRows>;
    try {
      parsed = parseCustomerRows(table.rows, table.headers, countryCode);
    } catch (error) {
      if (error instanceof CustomerColumnsError) {
        throw new BadRequestException({
          statusCode: 400,
          message: error.message,
          missingColumns: error.missing,
        });
      }
      throw error;
    }

    // Find the existing customers by NORMALISED phone: normalise every stored
    // phone of this shop the same way, keep only those the file mentions.
    const wanted = new Set(
      parsed.rows.map((r) => r.phone).filter((p): p is string => p !== null),
    );
    const idsByPhone = new Map<string, number[]>();
    const stored = await this.db.query<RowDataPacket[]>(
      `SELECT id, phone FROM customer WHERE shopId = ?`,
      [ctx.shopId],
    );
    for (const row of stored) {
      const normal = normaliseCustomerPhone(String(row.phone), countryCode);
      if (normal === null || !wanted.has(normal)) continue;
      const list = idsByPhone.get(normal) ?? [];
      list.push(row.id as number);
      idsByPhone.set(normal, list);
    }
    const ids = [...new Set([...idsByPhone.values()].flat())];
    const details = new Map<number, ExistingCustomer>();
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT id, name, email, addresses FROM customer
          WHERE shopId = ? AND id IN (${chunk.map(() => '?').join(', ')})`,
        [ctx.shopId, ...chunk],
      );
      for (const r of rows) {
        details.set(r.id as number, {
          id: r.id as number,
          name: r.name as string,
          email: (r.email as string | null) ?? null,
          addresses: (r.addresses as { address?: string }[] | null) ?? [],
        });
      }
    }
    const existing = new Map<string, ExistingCustomer[]>();
    for (const [phone, list] of idsByPhone) {
      existing.set(
        phone,
        list
          .map((id) => details.get(id))
          .filter((c): c is ExistingCustomer => !!c),
      );
    }
    return {
      parsed,
      plans: planCustomerImport(parsed.rows, existing, onExisting),
    };
  }

  private report(
    parsed: ReturnType<typeof parseCustomerRows>,
    plans: CustomerPlanRow[],
    onExisting: 'update' | 'skip',
  ): CustomerImportReport {
    const count = (a: CustomerPlanRow['action']) =>
      plans.filter((p) => p.action === a).length;
    const visible = [
      ...plans.filter((p) => p.action === 'error' || p.action === 'conflict'),
      ...plans.filter((p) => p.action !== 'error' && p.action !== 'conflict'),
    ].map((p) => ({
      rowNumber: p.rowNumber,
      name: p.name,
      phoneMasked: p.phoneMasked,
      action: p.action,
      reason: p.reason,
      changes: p.changes,
      warnings: p.warnings,
      errors: p.errors,
    }));
    const warnings = [...parsed.warnings];
    if (parsed.unsupportedColumns.length > 0) {
      warnings.push(
        `These columns have data but are not imported: ${parsed.unsupportedColumns.join(', ')}.`,
      );
    }
    return {
      source: 'customers',
      onExisting,
      totals: {
        rows: plans.length,
        create: count('create'),
        update: count('update'),
        skip: count('skip'),
        conflict: count('conflict'),
        error: count('error'),
      },
      rows: visible.slice(0, REPORT_ROW_CAP),
      truncated: visible.length > REPORT_ROW_CAP,
      warnings,
      unsupportedColumns: parsed.unsupportedColumns,
      note: NOTE,
    };
  }
}
