import { BadRequestException, Injectable } from '@nestjs/common';
import { OrdersService } from '../orders/orders.service';
import { OutletsService } from '../outlets/outlets.service';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import { ExternalDeliveriesService } from '../external-deliveries/external-deliveries.service';
import { SliderSettingsService } from './slider-settings.service';
import { SliderDeliveryProvider } from './slider/slider-delivery.provider';
import { geocodeAddress } from '../common/nominatim';
import type { TenantContext } from '../common/tenant-context';
import type { CreateSliderDeliveryDto } from './dto/create-slider-delivery.dto';
import { DeliveryProviderNotConfiguredException } from './slider-not-configured.exception';
import { mapSliderStatus } from './slider/slider-status-map';
import {
  assertPaymentOnDeliveryWithinCap,
  assertScheduleAtOk,
  assertVehicleDistanceOk,
} from './slider/slider-caps';

@Injectable()
export class SliderDeliveryService {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly outletsService: OutletsService,
    private readonly branchRolesService: BranchRolesService,
    private readonly externalDeliveriesService: ExternalDeliveriesService,
    private readonly sliderSettingsService: SliderSettingsService,
    private readonly sliderProvider: SliderDeliveryProvider,
  ) {}

  async getQuote(ctx: TenantContext, orderId: number) {
    const order = await this.ordersService.findOne(ctx, orderId);
    const credentials = await this.sliderSettingsService.resolveCredentials(
      ctx.shopId,
    );
    if (!credentials) {
      throw new DeliveryProviderNotConfiguredException('Slider');
    }
    const { pickup, delivery } = await this.resolvePoints(ctx, order);
    return this.sliderProvider.getQuote({ pickup, delivery, credentials });
  }

  async dispatch(
    ctx: TenantContext,
    orderId: number,
    dto: CreateSliderDeliveryDto,
  ) {
    const order = await this.ordersService.findOne(ctx, orderId);
    await this.branchRolesService.assertPermission(
      ctx,
      order.outletId,
      'orders.manage',
    );
    const credentials = await this.sliderSettingsService.resolveCredentials(
      ctx.shopId,
    );
    if (!credentials) {
      throw new DeliveryProviderNotConfiguredException('Slider');
    }
    const { outlet, pickup, delivery } = await this.resolvePoints(ctx, order);

    // Re-quote to get a real distance for the bike-cap check — trusting a
    // client-supplied distance here would be a spoof vector, and the fare
    // endpoint is a cheap read, so paying for one extra call is worth it.
    const quote = await this.sliderProvider.getQuote({
      pickup,
      delivery,
      credentials,
    });
    assertVehicleDistanceOk(dto.vehicleType, quote.distanceKm);
    assertPaymentOnDeliveryWithinCap(order.paymentMethod, Number(order.total));
    assertScheduleAtOk(dto.scheduleAt);

    const paymentOnDelivery =
      order.paymentMethod === 'cash_on_delivery'
        ? ({ type: 'cash', amount: Number(order.total) } as const)
        : order.paymentMethod === 'card_on_delivery'
          ? ({ type: 'card', amount: Number(order.total) } as const)
          : undefined;

    const created = await this.sliderProvider.createDelivery({
      orderId: order.id,
      displayOrderId: `#${order.id}`,
      vehicleType: dto.vehicleType,
      scheduleAt: dto.scheduleAt ?? null,
      driverTip: dto.driverTip,
      pickup: {
        address: [outlet.name, outlet.area, outlet.emirate]
          .filter(Boolean)
          .join(', '),
        latitude: pickup.latitude,
        longitude: pickup.longitude,
        contactNumber: outlet.phone ?? outlet.whatsapp ?? '',
      },
      dropoff: {
        address: order.customerAddress,
        latitude: delivery.latitude,
        longitude: delivery.longitude,
        contactNumber: order.customerPhone,
      },
      paymentOnDelivery,
      credentials,
    });

    // Duplicate-key -> ConflictException happens here for free (see
    // ExternalDeliveriesService.createSliderDelivery) if this order somehow
    // already has a delivery logged — the unique index on orderId is the
    // real guard, not a separate pre-check.
    await this.externalDeliveriesService.createSliderDelivery(orderId, {
      vehicleType: dto.vehicleType,
      price: created.fee,
      destination: order.customerAddress,
      status: mapSliderStatus(created.status),
      sliderOrderNumber: created.orderNumber,
      trackingUrl: created.trackingUrl,
    });

    return this.ordersService.findOneDetail(ctx, orderId);
  }

  async cancel(ctx: TenantContext, orderId: number) {
    const order = await this.ordersService.findOne(ctx, orderId);
    await this.branchRolesService.assertPermission(
      ctx,
      order.outletId,
      'orders.manage',
    );
    const delivery =
      await this.externalDeliveriesService.findByOrderIdOrNull(orderId);
    if (
      !delivery ||
      delivery.provider !== 'slider' ||
      !delivery.sliderOrderNumber
    ) {
      throw new BadRequestException(
        'No Slider delivery to cancel for this order',
      );
    }
    const credentials = await this.sliderSettingsService.resolveCredentials(
      ctx.shopId,
    );
    if (!credentials) {
      throw new DeliveryProviderNotConfiguredException('Slider');
    }
    // Slider itself is the authority on "only pending deliveries can be
    // cancelled" — its own error (mapped to an HttpException with the real
    // status/message, see SliderDeliveryProvider) surfaces directly rather
    // than us guessing which of our locally-mapped statuses still count as
    // cancellable on Slider's side.
    await this.sliderProvider.cancelDelivery(
      delivery.sliderOrderNumber,
      credentials,
    );
    await this.externalDeliveriesService.updateSliderDeliveryByOrderNumber(
      delivery.sliderOrderNumber,
      { status: 'cancelled' },
    );
    return this.ordersService.findOneDetail(ctx, orderId);
  }

  private async resolvePoints(
    ctx: TenantContext,
    order: Awaited<ReturnType<OrdersService['findOne']>>,
  ) {
    const outlet = await this.outletsService.findOne(ctx, order.outletId);
    if (outlet.latitude === null || outlet.longitude === null) {
      throw new BadRequestException(
        'This outlet has no map location set — set one in Outlet settings before dispatching a Slider delivery',
      );
    }
    // Manual-trigger geocode (the merchant clicking "Send to Slider"), same
    // rate-limit-friendly usage pattern common/nominatim.ts already
    // documents for outlet-address entry / checkout pin-drag — never
    // autocomplete-as-you-type.
    const deliveryPoint = await geocodeAddress(
      [order.customerAddress, order.area, order.emirate, 'UAE']
        .filter(Boolean)
        .join(', '),
    );
    return {
      outlet,
      pickup: { latitude: outlet.latitude, longitude: outlet.longitude },
      delivery: {
        latitude: deliveryPoint.latitude,
        longitude: deliveryPoint.longitude,
      },
    };
  }
}
