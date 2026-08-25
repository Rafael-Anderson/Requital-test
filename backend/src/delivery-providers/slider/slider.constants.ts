// Sandbox-only for now (see delivery-providers.module.ts) — production is
// listed here so the base-URL selection is config-driven from day one and
// never needs a second lookup added later, but nothing in this codebase
// currently allows a shop's environment to actually be set to it.
export const SLIDER_BASE_URLS = {
  sandbox: 'https://api-sandbox.slider-app.com/v1',
  production: 'https://api.slider-app.com/v1',
} as const;
export type SliderEnvironment = keyof typeof SLIDER_BASE_URLS;

export const SLIDER_VEHICLE_TYPES = ['bike', 'car', 'any'] as const;
export type SliderVehicleType = (typeof SLIDER_VEHICLE_TYPES)[number];

export const SLIDER_BIKE_MAX_DISTANCE_KM = 35;
export const SLIDER_COD_CASH_CAP_AED = 350;
export const SLIDER_COD_CARD_CAP_AED = 500;
export const SLIDER_MIN_SCHEDULE_MINUTES = 30;

export const SLIDER_WEBHOOK_TOKEN_HEADER = 'x-slider-webhook-token';
