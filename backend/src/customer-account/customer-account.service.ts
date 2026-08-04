import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CustomerContext } from '../customer-auth/customer-context';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SaveAddressDto } from './dto/save-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { InvoicesService } from '../invoices/invoices.service';

export interface CustomerAddress {
  id: string;
  label?: string;
  address: string;
  emirate: string;
  area?: string;
  latitude?: number;
  longitude?: number;
}

const orderInclude = {
  orderitem: {
    select: {
      productName: true,
      variantLabel: true,
      quantity: true,
      priceAtPurchase: true,
    },
  },
  outlet: { select: { name: true } },
} satisfies Prisma.orderInclude;

@Injectable()
export class CustomerAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
  ) {}

  getInvoiceHtml(ctx: CustomerContext, orderId: number) {
    return this.invoicesService.renderHtmlForCustomerOrder(
      ctx.shopId,
      ctx.customerId,
      orderId,
    );
  }

  async getProfile(ctx: CustomerContext) {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: ctx.customerId },
    });
    return this.toProfileResponse(customer);
  }

  async updateProfile(ctx: CustomerContext, dto: UpdateProfileDto) {
    try {
      const customer = await this.prisma.customer.update({
        where: { id: ctx.customerId },
        data: { name: dto.name, email: dto.email, phone: dto.phone },
      });
      return this.toProfileResponse(customer);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Another account with this phone number already exists',
        );
      }
      throw error;
    }
  }

  // Not outlet-scoped — a customer's order history spans every branch of
  // this shop they've ordered from, same as the admin CRM's per-customer
  // order list (CustomersService.findOne).
  async listOrders(ctx: CustomerContext) {
    const orders = await this.prisma.order.findMany({
      where: { customerId: ctx.customerId, shopId: ctx.shopId },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
    });
    // One query for every order's invoice existence rather than N+1 —
    // "Download Invoice" only ever renders for the storefront-facing
    // INVOICE type, never PACKING_SLIP (that stays admin/courier-only).
    const invoicedOrderIds = await this.invoicedOrderIds(
      orders.map((o) => o.id),
    );
    return orders.map((o) => this.toOrderSummary(o, invoicedOrderIds.has(o.id)));
  }

  // customerId AND shopId both in the WHERE — an id belonging to another
  // customer (even one in this same shop) or another shop entirely simply
  // doesn't match, and returns the same 404 either way, never leaking which
  // case it was.
  async getOrder(ctx: CustomerContext, id: number) {
    const order = await this.prisma.order.findFirst({
      where: { id, customerId: ctx.customerId, shopId: ctx.shopId },
      include: orderInclude,
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    const invoicedOrderIds = await this.invoicedOrderIds([order.id]);
    return this.toOrderSummary(order, invoicedOrderIds.has(order.id));
  }

  private async invoicedOrderIds(orderIds: number[]): Promise<Set<number>> {
    if (orderIds.length === 0) return new Set();
    const rows = await this.prisma.invoice.findMany({
      where: { orderId: { in: orderIds }, type: 'INVOICE' },
      select: { orderId: true },
    });
    return new Set(rows.map((r) => r.orderId));
  }

  async listAddresses(ctx: CustomerContext): Promise<CustomerAddress[]> {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: ctx.customerId },
    });
    return (customer.addresses as CustomerAddress[] | null) ?? [];
  }

  async createAddress(
    ctx: CustomerContext,
    dto: SaveAddressDto,
  ): Promise<CustomerAddress> {
    const addresses = await this.listAddresses(ctx);
    const address: CustomerAddress = { id: randomUUID().slice(0, 8), ...dto };
    await this.prisma.customer.update({
      where: { id: ctx.customerId },
      data: {
        addresses: [...addresses, address] as unknown as Prisma.InputJsonValue,
      },
    });
    return address;
  }

  async updateAddress(
    ctx: CustomerContext,
    addressId: string,
    dto: UpdateAddressDto,
  ): Promise<CustomerAddress> {
    const addresses = await this.listAddresses(ctx);
    const index = addresses.findIndex((a) => a.id === addressId);
    if (index === -1) {
      throw new NotFoundException(`Address ${addressId} not found`);
    }
    const updated: CustomerAddress = { ...addresses[index], ...dto };
    addresses[index] = updated;
    await this.prisma.customer.update({
      where: { id: ctx.customerId },
      data: { addresses: addresses as unknown as Prisma.InputJsonValue },
    });
    return updated;
  }

  async deleteAddress(ctx: CustomerContext, addressId: string) {
    const addresses = await this.listAddresses(ctx);
    if (!addresses.some((a) => a.id === addressId)) {
      throw new NotFoundException(`Address ${addressId} not found`);
    }
    const next = addresses.filter((a) => a.id !== addressId);
    await this.prisma.customer.update({
      where: { id: ctx.customerId },
      data: { addresses: next as unknown as Prisma.InputJsonValue },
    });
    return { id: addressId, deleted: true };
  }

  private toProfileResponse(customer: {
    id: number;
    shopId: number;
    name: string;
    phone: string;
    email: string | null;
    emailVerified: boolean;
    registeredAt: Date | null;
    createdAt: Date;
  }) {
    const {
      id,
      shopId,
      name,
      phone,
      email,
      emailVerified,
      registeredAt,
      createdAt,
    } = customer;
    return {
      id,
      shopId,
      name,
      phone,
      email,
      emailVerified,
      registeredAt,
      createdAt,
    };
  }

  private toOrderSummary(
    order: Prisma.orderGetPayload<{ include: typeof orderInclude }>,
    hasInvoice: boolean,
  ) {
    return {
      id: order.id,
      status: order.status,
      orderType: order.orderType,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      outletName: order.outlet.name,
      deliveryDate: order.deliveryDate,
      deliveryTimeSlot: order.deliveryTimeSlot,
      customerAddress: order.customerAddress,
      items: order.orderitem,
      deliveryFee: order.deliveryFee,
      taxAmount: order.taxAmount,
      discountAmount: order.discountAmount,
      total: order.total,
      trackingToken: order.trackingToken,
      createdAt: order.createdAt,
      hasInvoice,
    };
  }
}
