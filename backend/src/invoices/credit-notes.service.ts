import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { trimDecimal } from '../database/decimal.util';
import { isDuplicateKeyError } from '../database/mysql-errors';
import type { CreditnoteRow, InvoiceRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { roundMoney, toMinorUnits } from '../common/currency-minor-units';
import { OrdersService } from '../orders/orders.service';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { InvoicesService } from './invoices.service';
import { IssueCreditNoteDto } from './dto/issue-credit-note.dto';
import { CREDIT_NOTE_COUNTER_TYPE } from './invoices.constants';
import {
  computeReturnCredit,
  CreditNoteTaxUnknownError,
} from './credit-note-amounts';
import { renderInvoiceHtml } from './invoice-html';
import { buildTaxBreakdown } from './invoice-tax';

export const CREDIT_NOTE_SNAPSHOT_VERSION = 1;

// Everything the credit note prints except its own money columns, frozen at
// issue. Dates are ISO strings (that is what JSON.stringify makes of a Date) and
// are revived at render time.
interface CreditNoteSnapshot {
  originalInvoiceNumber: string;
  originalInvoiceIssuedAt: string;
  taxInclusive: boolean;
  orderNumber: number;
  orderCreatedAt: string;
  shopName: string;
  shopAddress: string | null;
  shopEmail: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  customerAddress: string;
  regionName: string | null;
  area: string | null;
  discountCode: string | null;
  // The credited share of the order's discount / delivery fee. NULL = none.
  discountAmount: number | null;
  deliveryFee: number | null;
  // What the return itself recorded as refunded, for reference only. A credit
  // note reverses the SALE (captured price and tax of the returned units), so
  // this can legitimately differ: the return flow refunds the line price and
  // ignores order discounts and exclusive-pricing tax. Nothing here changes it.
  returnRefundAmount: number | null;
  lines: {
    productName: string;
    variantLabel: string | null;
    quantity: number;
    unitPrice: number;
    // NULL = the order predates tax capture (unknown, never zero).
    taxRate: number | null;
    taxAmount: number | null;
  }[];
}

const COLUMNS = `id, shopId, orderId, invoiceId, number, reason, returnId, currency,
  subtotal, taxAmount, total, snapshotVersion, createdBy, createdAt`;

function toResponse(row: Omit<CreditnoteRow, 'snapshotJson'>) {
  return {
    ...row,
    subtotal: trimDecimal(row.subtotal),
    taxAmount: trimDecimal(row.taxAmount),
    total: trimDecimal(row.total),
  };
}

// Credit notes are DOCUMENTS ONLY. Nothing in this service writes to `order`,
// `orderitem`, `paymenttransaction` or `orderreturn`: the money has already
// moved (or not) through the return / cancellation flows, and a credit note is
// the accounting record of that reversal. `credit-notes.e2e-spec.ts` asserts the
// order, payment and return rows are byte-identical after issuing.
@Injectable()
export class CreditNotesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly ordersService: OrdersService,
    private readonly invoicesService: InvoicesService,
    private readonly branchRolesService: BranchRolesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async issue(ctx: TenantContext, dto: IssueCreditNoteDto) {
    // 404s for another shop's order (and a sibling outlet's, for a branch user).
    const order = await this.ordersService.findOne(ctx, dto.orderId);
    await this.branchRolesService.assertPermission(
      ctx,
      order.outletId,
      'orders.manage',
    );

    if (dto.reason === 'return' && dto.returnId == null) {
      throw new BadRequestException('A return credit note needs a returnId');
    }
    if (dto.reason !== 'return' && dto.returnId != null) {
      throw new BadRequestException(
        'returnId is only valid for a credit note with reason "return"',
      );
    }
    if (dto.reason === 'cancellation' && order.status !== 'cancelled') {
      throw new BadRequestException(
        'A cancellation credit note needs a cancelled order',
      );
    }

    const invoiceRows = await this.db.query<(InvoiceRow & RowDataPacket)[]>(
      `SELECT * FROM invoice WHERE orderId = ? AND shopId = ? AND type = 'INVOICE'`,
      [order.id, ctx.shopId],
    );
    const invoice = invoiceRows[0];
    if (!invoice) {
      throw new BadRequestException(
        'Generate an invoice for this order before issuing a credit note',
      );
    }

    // The frozen document the credit note reverses: its customer/shop blocks and
    // (for a full credit note) its lines. Falls back to the live order for an
    // invoice that predates snapshots, exactly as the invoice itself renders.
    const live = await this.invoicesService.loadOrderForInvoice(
      order.id,
      ctx.shopId,
    );
    if (!live) throw new NotFoundException(`Order ${order.id} not found`);
    const source = this.invoicesService.resolveRenderSource(invoice, live).order;

    const currency = invoice.currency;
    let figures: { subtotal: number; taxAmount: number; total: number };
    let snapshotLines: CreditNoteSnapshot['lines'];
    let discountAmount: number | null;
    let deliveryFee: number | null;
    let returnRefundAmount: number | null = null;

    if (dto.reason === 'return') {
      const returnRows = await this.db.query<RowDataPacket[]>(
        `SELECT id, refundAmount FROM orderreturn WHERE id = ? AND orderId = ?`,
        [dto.returnId as number, order.id],
      );
      if (!returnRows[0]) {
        throw new NotFoundException(`Return ${dto.returnId} not found`);
      }
      returnRefundAmount = Number(returnRows[0].refundAmount);
      const returned = await this.db.query<RowDataPacket[]>(
        `SELECT orderItemId, quantity FROM orderreturnitem WHERE orderReturnId = ?`,
        [dto.returnId as number],
      );
      try {
        const credit = computeReturnCredit({
          orderLines: order.orderitem,
          returned: returned.map((r) => ({
            orderItemId: r.orderItemId as number,
            quantity: r.quantity as number,
          })),
          discountAmount: order.discountAmount,
          taxInclusive: invoice.taxInclusive,
          currency,
        });
        figures = credit;
        discountAmount = credit.discountAmount;
        deliveryFee = null;
        const itemById = new Map(
          order.orderitem.map(
            (i: {
              id: number;
              productName: string;
              variantLabel: string | null;
            }) => [i.id, i] as const,
          ),
        );
        snapshotLines = credit.lines.map((l) => {
          const item = itemById.get(l.orderItemId)!;
          return {
            productName: item.productName,
            variantLabel: item.variantLabel,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate,
            taxAmount: l.taxAmount,
          };
        });
      } catch (error) {
        if (error instanceof CreditNoteTaxUnknownError) {
          // NULL tax capture is UNKNOWN, not zero. Splitting a return's tax out
          // of an order that never recorded per-line tax would be inventing it.
          throw new BadRequestException(
            'This order predates per-line tax capture, so the tax on the returned items is unknown. Issue a full credit note instead.',
          );
        }
        throw error;
      }
    } else {
      // Full credit note: the invoice's own frozen figures, so it is exactly the
      // reversal of what was issued, including delivery and discount. No per-line
      // tax is needed, which is why this works on a pre-capture order too (the
      // lines then print their tax as unknown, as the invoice does).
      figures = {
        subtotal: roundMoney(Number(invoice.subtotal), currency),
        taxAmount: roundMoney(Number(invoice.taxAmount), currency),
        total: roundMoney(Number(invoice.total), currency),
      };
      discountAmount =
        source.discountAmount == null ? null : Number(source.discountAmount);
      deliveryFee = source.deliveryFee == null ? null : Number(source.deliveryFee);
      snapshotLines = source.orderitem.map((i) => ({
        productName: i.productName,
        variantLabel: i.variantLabel,
        quantity: i.quantity,
        unitPrice: Number(i.priceAtPurchase),
        taxRate: i.taxRate == null ? null : Number(i.taxRate),
        taxAmount: i.taxAmount == null ? null : Number(i.taxAmount),
      }));
    }

    const snapshot: CreditNoteSnapshot = {
      originalInvoiceNumber: invoice.invoiceNumber,
      originalInvoiceIssuedAt: invoice.issuedAt.toISOString(),
      taxInclusive: invoice.taxInclusive,
      orderNumber: source.shopOrderNumber,
      orderCreatedAt: source.createdAt.toISOString(),
      shopName: source.shopDisplayName ?? source.shopName,
      shopAddress: source.shopAddress,
      shopEmail: source.shopEmail,
      customerName: source.customerName,
      customerPhone: source.customerPhone,
      customerEmail: source.customerEmail,
      customerAddress: source.customerAddress,
      regionName: source.regionName,
      area: source.area,
      discountCode: source.discountCode,
      discountAmount,
      deliveryFee,
      returnRefundAmount,
      lines: snapshotLines,
    };

    let id: number;
    try {
      id = await this.db.transaction(async (conn) => {
        // Serialises every credit-note issue against this invoice: the cap check
        // below is read-then-insert, which two concurrent callers would both pass.
        // Row lock on the invoice, held until commit.
        const [locked] = await conn.query<RowDataPacket[]>(
          `SELECT total FROM invoice WHERE id = ? AND shopId = ? FOR UPDATE`,
          [invoice.id, ctx.shopId],
        );
        if (!locked[0]) throw new NotFoundException('Invoice not found');

        const [agg] = await conn.query<RowDataPacket[]>(
          `SELECT COALESCE(SUM(total), 0) AS credited,
                  COUNT(*) AS n,
                  COALESCE(SUM(returnId IS NULL), 0) AS fullNotes,
                  COALESCE(SUM(returnId <=> ?), 0) AS sameReturn
             FROM creditnote WHERE invoiceId = ?`,
          [dto.returnId ?? -1, invoice.id],
        );
        const credited = Number(agg[0].credited);
        if (Number(agg[0].sameReturn) > 0 && dto.returnId != null) {
          throw new ConflictException(
            'A credit note has already been issued for this return',
          );
        }
        if (Number(agg[0].fullNotes) > 0) {
          throw new ConflictException(
            'This invoice has already been credited in full',
          );
        }
        if (dto.returnId == null && Number(agg[0].n) > 0) {
          throw new ConflictException(
            'A full credit note covers the whole invoice, but it already has credit notes',
          );
        }
        // Integer minor units, so a float sum cannot straddle the cap by a hair.
        if (
          toMinorUnits(credited, currency) + toMinorUnits(figures.total, currency) >
          toMinorUnits(Number(locked[0].total), currency)
        ) {
          throw new BadRequestException(
            'Credit notes for this invoice would exceed its total',
          );
        }

        // Numbered only after every check passed, inside the same transaction, so
        // a rejected attempt never burns a CN number (a gap in a credit-note
        // sequence is an audit question).
        const number = await this.invoicesService.nextInvoiceNumber(
          conn,
          ctx.shopId,
          CREDIT_NOTE_COUNTER_TYPE,
        );
        const [result] = await conn.query(
          `INSERT INTO creditnote (shopId, orderId, invoiceId, number, reason, returnId, currency,
                                   subtotal, taxAmount, total, snapshotJson, snapshotVersion, createdBy)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ctx.shopId,
            order.id,
            invoice.id,
            number,
            dto.reason,
            dto.returnId ?? null,
            currency,
            figures.subtotal,
            figures.taxAmount,
            figures.total,
            JSON.stringify(snapshot),
            CREDIT_NOTE_SNAPSHOT_VERSION,
            ctx.userId,
          ],
        );
        return (result as { insertId: number }).insertId;
      });
    } catch (error) {
      // Backstop for the UNIQUE(returnId) index; the locked pre-check above
      // normally answers first.
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'A credit note has already been issued for this return',
        );
      }
      throw error;
    }

    const rows = await this.db.query<(CreditnoteRow & RowDataPacket)[]>(
      `SELECT ${COLUMNS} FROM creditnote WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    await this.auditLogService.logCtx(ctx, {
      action: 'order.credit_note.issued',
      entityType: 'creditnote',
      entityId: id,
      after: {
        orderId: order.id,
        invoiceId: invoice.id,
        number: rows[0].number,
        reason: dto.reason,
        total: String(figures.total),
        currency,
      },
    });
    return toResponse(rows[0]);
  }

  async findAllForOrder(ctx: TenantContext, orderId: number) {
    await this.ordersService.findOne(ctx, orderId); // tenant/outlet/permission scope
    const rows = await this.db.query<(CreditnoteRow & RowDataPacket)[]>(
      `SELECT ${COLUMNS} FROM creditnote WHERE orderId = ? AND shopId = ? ORDER BY id ASC`,
      [orderId, ctx.shopId],
    );
    return rows.map(toResponse);
  }

  async renderHtml(ctx: TenantContext, id: number): Promise<string> {
    const rows = await this.db.query<(CreditnoteRow & RowDataPacket)[]>(
      `SELECT * FROM creditnote WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    const note = rows[0];
    if (!note) throw new NotFoundException(`Credit note ${id} not found`);
    // Same outlet scoping and orders.view permission as the order itself.
    await this.ordersService.findOne(ctx, note.orderId);

    const snap = note.snapshotJson as unknown as CreditNoteSnapshot;
    const lines = snap.lines.map((l) => ({
      productName: l.productName,
      variantLabel: l.variantLabel,
      quantity: l.quantity,
      priceAtPurchase: l.unitPrice,
      autoDiscountAmount: null,
      taxRate: l.taxRate,
      taxAmount: l.taxAmount,
    }));
    return renderInvoiceHtml({
      invoiceNumber: note.number,
      type: 'CREDIT_NOTE',
      issuedAt: note.createdAt,
      creditNote: {
        originalInvoiceNumber: snap.originalInvoiceNumber,
        originalInvoiceIssuedAt: new Date(snap.originalInvoiceIssuedAt),
        reason: note.reason,
      },
      subtotal: note.subtotal,
      taxAmount: note.taxAmount,
      total: note.total,
      taxInclusive: snap.taxInclusive,
      taxBreakdown: buildTaxBreakdown({
        items: lines,
        discountAmount: snap.discountAmount,
        taxInclusive: snap.taxInclusive,
        orderTaxAmount: note.taxAmount,
      }),
      notes: null,
      shopName: snap.shopName,
      shopAddress: snap.shopAddress,
      shopEmail: snap.shopEmail,
      // The credit note's OWN captured currency, never the shop's live one.
      currency: note.currency,
      order: {
        id: note.orderId,
        shopOrderNumber: snap.orderNumber,
        customerName: snap.customerName,
        customerPhone: snap.customerPhone,
        customerEmail: snap.customerEmail,
        customerAddress: snap.customerAddress,
        regionName: snap.regionName,
        area: snap.area,
        createdAt: new Date(snap.orderCreatedAt),
        deliveryFee: snap.deliveryFee,
        discountAmount: snap.discountAmount,
        discountCode: snap.discountCode,
        paymentMethod: null,
        paymentStatus: '',
        orderitem: lines,
      },
    });
  }
}
