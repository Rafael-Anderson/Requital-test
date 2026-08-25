import type { SliderVehicleType } from './slider.constants';

// ponytail: one implementation (Slider) exists today — this interface exists
// only because the task explicitly asked for provider parity with
// payments/payment-provider.interface.ts, and a future second courier
// (Lalamove, out of scope for this PR) would slot in against it without
// reshaping SliderDeliveryService. No registry/factory around it yet (unlike
// PaymentProviderRegistry) — add one only once a shop actually has more than
// one courier to choose between.
export interface DeliveryProviderCredentials {
  apiKey: string;
  accountId: string;
  baseUrl: string;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface DeliveryQuoteParams {
  pickup: GeoPoint;
  delivery: GeoPoint;
  credentials: DeliveryProviderCredentials;
}

export interface DeliveryQuoteVehicle {
  // Slider's own vehicle_type string, not narrowed to SliderVehicleType —
  // a quote can list vehicle types beyond the 3 this app lets a merchant
  // pick when dispatching (see CreateDeliveryParams.vehicleType).
  vehicleType: string;
  deliveryFee: number;
  isAvailable: boolean;
  unavailableReason: string | null;
}

export interface DeliveryQuote {
  distanceKm: number;
  durationMinutes: number;
  vehicles: DeliveryQuoteVehicle[];
}

export interface CreateDeliveryParams {
  orderId: number;
  displayOrderId?: string;
  vehicleType: SliderVehicleType;
  scheduleAt: string | null;
  driverTip?: number;
  pickup: {
    address: string;
    latitude: number;
    longitude: number;
    directions?: string;
    contactNumber: string;
  };
  dropoff: {
    address: string;
    latitude: number;
    longitude: number;
    directions?: string;
    contactNumber: string;
  };
  paymentOnDelivery?: { type: 'cash' | 'card'; amount: number };
  credentials: DeliveryProviderCredentials;
}

export interface CreatedDelivery {
  orderNumber: number;
  status: string;
  fee: number;
  currency: string;
  distanceKm: number;
  trackingUrl: string;
  createdAt: string;
}

export interface DeliveryStatusDriver {
  name: string;
  phoneNumber: string;
  latitude: number;
  longitude: number;
  vehicle: string;
}

export interface DeliveryStatus {
  orderNumber: number;
  status: string;
  driver: DeliveryStatusDriver | null;
  trackingUrl: string;
}

export interface DeliveryProvider {
  readonly name: string;
  getQuote(params: DeliveryQuoteParams): Promise<DeliveryQuote>;
  createDelivery(params: CreateDeliveryParams): Promise<CreatedDelivery>;
  getStatus(
    orderNumber: number,
    credentials: DeliveryProviderCredentials,
  ): Promise<DeliveryStatus>;
  cancelDelivery(
    orderNumber: number,
    credentials: DeliveryProviderCredentials,
  ): Promise<void>;
}
