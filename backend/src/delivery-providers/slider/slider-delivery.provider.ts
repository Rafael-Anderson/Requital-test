import { HttpException, Injectable } from '@nestjs/common';
import type {
  CreateDeliveryParams,
  CreatedDelivery,
  DeliveryProvider,
  DeliveryProviderCredentials,
  DeliveryQuote,
  DeliveryQuoteParams,
  DeliveryStatus,
} from './slider-delivery.interface';
import { createLogger } from '../../common/logging/logger';

const logger = createLogger('SliderDeliveryProvider');

interface SliderFareVehicle {
  vehicle_type: string;
  delivery_fee: number;
  is_available: boolean;
  unavailable_reason: string | null;
}

interface SliderFareResponse {
  distance_km: number;
  duration_minutes: number;
  vehicles: SliderFareVehicle[];
}

interface SliderCreateResponse {
  order_number: number;
  status: string;
  fare: number;
  currency: string;
  distance_km: number;
  tracking_url: string;
  created_at: string;
}

interface SliderStatusResponse {
  order_number: number;
  status: string;
  tracking_url: string;
  driver?: {
    name: string;
    phone_number: string;
    latitude: number;
    longitude: number;
    vehicle: string;
  } | null;
}

const STATUS_MESSAGES: Record<number, string> = {
  400: 'Slider rejected the request as malformed',
  401: 'Slider rejected the API key configured for this shop',
  402: 'This shop’s Slider wallet has insufficient balance',
  403: 'This delivery does not belong to this shop’s Slider account',
  404: 'Slider delivery not found',
  422: 'Slider rejected this delivery (validation failed — check COD/schedule/area)',
  500: 'Slider had a server error — try again shortly',
};

// One retry, only on a genuinely-received 5xx response — never on a
// thrown/network error (timeout, DNS, abort). This is what makes "never
// retry POST /deliveries on timeout without first checking status by
// order_id" hold for free: a timeout throws before a response exists, so it
// always falls through to the caller unretried, for every method here —
// there is no per-endpoint special case to keep in sync.
async function sliderFetch<T>(
  url: string,
  init: RequestInit,
  apiKey: string,
): Promise<T> {
  const headers = {
    'X-Slider-Key': apiKey,
    'Content-Type': 'application/json',
    ...init.headers,
  };
  let res: Response;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    res = await fetch(url, { ...init, headers });
    if (res.ok || res.status < 500 || attempt >= 2) break;
    logger.warn(`Slider ${res.status} on attempt ${attempt}, retrying once`, {
      url,
    });
  }
  if (!res.ok) {
    const message =
      STATUS_MESSAGES[res.status] ?? `Slider API error (${res.status})`;
    let detail = '';
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) detail = `: ${body.message}`;
    } catch {
      // Non-JSON error body — the generic message above is all we get.
    }
    throw new HttpException(`${message}${detail}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

@Injectable()
export class SliderDeliveryProvider implements DeliveryProvider {
  readonly name = 'slider';

  async getQuote(params: DeliveryQuoteParams): Promise<DeliveryQuote> {
    const data = await sliderFetch<SliderFareResponse>(
      `${params.credentials.baseUrl}/deliveries/fare`,
      {
        method: 'POST',
        body: JSON.stringify({
          account_id: params.credentials.accountId,
          pickup: {
            latitude: params.pickup.latitude,
            longitude: params.pickup.longitude,
          },
          delivery: {
            latitude: params.delivery.latitude,
            longitude: params.delivery.longitude,
          },
        }),
      },
      params.credentials.apiKey,
    );
    return {
      distanceKm: data.distance_km,
      durationMinutes: data.duration_minutes,
      vehicles: data.vehicles.map((v) => ({
        vehicleType: v.vehicle_type,
        deliveryFee: v.delivery_fee,
        isAvailable: v.is_available,
        unavailableReason: v.unavailable_reason,
      })),
    };
  }

  async createDelivery(params: CreateDeliveryParams): Promise<CreatedDelivery> {
    const data = await sliderFetch<SliderCreateResponse>(
      `${params.credentials.baseUrl}/deliveries`,
      {
        method: 'POST',
        body: JSON.stringify({
          order_id: params.orderId,
          account_id: params.credentials.accountId,
          display_order_id: params.displayOrderId,
          vehicle_type: params.vehicleType,
          schedule_at: params.scheduleAt,
          driver_tip: params.driverTip,
          pickup: {
            address: params.pickup.address,
            latitude: params.pickup.latitude,
            longitude: params.pickup.longitude,
            directions: params.pickup.directions,
            contact_number: params.pickup.contactNumber,
          },
          dropoff: {
            address: params.dropoff.address,
            latitude: params.dropoff.latitude,
            longitude: params.dropoff.longitude,
            directions: params.dropoff.directions,
            contact_number: params.dropoff.contactNumber,
          },
          payment_on_delivery: params.paymentOnDelivery
            ? {
                type: params.paymentOnDelivery.type,
                amount: params.paymentOnDelivery.amount,
              }
            : undefined,
        }),
      },
      params.credentials.apiKey,
    );
    return {
      orderNumber: data.order_number,
      status: data.status,
      fee: data.fare,
      currency: data.currency,
      distanceKm: data.distance_km,
      trackingUrl: data.tracking_url,
      createdAt: data.created_at,
    };
  }

  // ponytail: implemented for interface parity (the spec lists this as one
  // of the 4 required provider methods) but nothing calls it live today —
  // admin status is read from our own DB, refreshed only by the webhook (see
  // "Live-ish status" in the integration spec), never by polling Slider.
  // Wire it up if a manual "refresh from Slider" admin action is ever added.
  async getStatus(
    orderNumber: number,
    credentials: DeliveryProviderCredentials,
  ): Promise<DeliveryStatus> {
    const data = await sliderFetch<SliderStatusResponse>(
      `${credentials.baseUrl}/deliveries/${orderNumber}`,
      { method: 'GET' },
      credentials.apiKey,
    );
    return {
      orderNumber: data.order_number,
      status: data.status,
      trackingUrl: data.tracking_url,
      driver: data.driver
        ? {
            name: data.driver.name,
            phoneNumber: data.driver.phone_number,
            latitude: data.driver.latitude,
            longitude: data.driver.longitude,
            vehicle: data.driver.vehicle,
          }
        : null,
    };
  }

  async cancelDelivery(
    orderNumber: number,
    credentials: DeliveryProviderCredentials,
  ): Promise<void> {
    await sliderFetch<void>(
      `${credentials.baseUrl}/deliveries/${orderNumber}`,
      { method: 'DELETE' },
      credentials.apiKey,
    );
  }
}
