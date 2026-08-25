import { BadRequestException } from '@nestjs/common';
import {
  SLIDER_BIKE_MAX_DISTANCE_KM,
  SLIDER_COD_CARD_CAP_AED,
  SLIDER_COD_CASH_CAP_AED,
  SLIDER_MIN_SCHEDULE_MINUTES,
  type SliderVehicleType,
} from './slider.constants';

// Pure, framework-free checks — enforced client-side (i.e. by us, before
// calling Slider) so a request that would 422 never burns an API call. Each
// throws BadRequestException with a merchant-readable message; callers run
// these before createDelivery, not instead of trusting Slider's own 422 (a
// real API-side rule change still surfaces as a normal error from the HTTP
// call).

export function assertPaymentOnDeliveryWithinCap(
  paymentMethod: string | null,
  amountAed: number,
): void {
  if (
    paymentMethod === 'cash_on_delivery' &&
    amountAed > SLIDER_COD_CASH_CAP_AED
  ) {
    throw new BadRequestException(
      `Cash on delivery orders over AED ${SLIDER_COD_CASH_CAP_AED} cannot be dispatched via Slider (this order is AED ${amountAed.toFixed(2)})`,
    );
  }
  if (
    paymentMethod === 'card_on_delivery' &&
    amountAed > SLIDER_COD_CARD_CAP_AED
  ) {
    throw new BadRequestException(
      `Card on delivery orders over AED ${SLIDER_COD_CARD_CAP_AED} cannot be dispatched via Slider (this order is AED ${amountAed.toFixed(2)})`,
    );
  }
}

export function assertVehicleDistanceOk(
  vehicleType: SliderVehicleType,
  distanceKm: number,
): void {
  if (vehicleType === 'bike' && distanceKm > SLIDER_BIKE_MAX_DISTANCE_KM) {
    throw new BadRequestException(
      `Bike deliveries are limited to ${SLIDER_BIKE_MAX_DISTANCE_KM}km (this delivery is ${distanceKm.toFixed(1)}km) — choose "car" or "any" instead`,
    );
  }
}

export function assertScheduleAtOk(
  scheduleAt: string | null | undefined,
): void {
  if (!scheduleAt) return;
  const scheduled = new Date(scheduleAt);
  if (Number.isNaN(scheduled.getTime())) {
    throw new BadRequestException('scheduleAt must be a valid ISO 8601 date');
  }
  const minAllowed = Date.now() + SLIDER_MIN_SCHEDULE_MINUTES * 60_000;
  if (scheduled.getTime() < minAllowed) {
    throw new BadRequestException(
      `scheduleAt must be at least ${SLIDER_MIN_SCHEDULE_MINUTES} minutes in the future`,
    );
  }
}
