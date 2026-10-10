import { API_URL } from "./api";

// The driver's mobile web app talks to the un-slugged /driver-app API with the
// magic-link secret in a header. Deliberately NOT built on apiFetch: no cookies
// (credentials "omit", so a staff session in the same browser is never sent and
// no CSRF token is involved), no silent refresh, no 401 handling that would sign
// anyone out. The secret never goes in a query string.

export class DriverApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export interface DriverStop {
  id: number;
  position: number;
  status: "pending" | "delivered" | "failed";
  failureReason: string | null;
  orderNumber: number;
  customerName: string;
  customerPhone: string;
  address: string;
  deliveryNotes: string | null;
  timeSlot: string | null;
  items: string[];
  deliverable: boolean;
  orderCancelled: boolean;
  cod: { amount: string; currency: string; alreadyCollected: boolean } | null;
  proof: { hasPhoto: boolean; codActive: boolean; codSendsLeft: number };
  cashDiscrepancy: boolean;
}

export interface DriverRunView {
  shopName: string;
  driverName: string;
  run: { status: string; proofRequirement: "photo_or_otp" | "photo" | "otp" | "none" };
  stops: DriverStop[];
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(`${API_URL}/driver-app${path}`, {
    ...init,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: {
      ...(isForm || !init.body ? {} : { "Content-Type": "application/json" }),
      "X-Driver-Token": token,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string | string[]; code?: string } | null;
    const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
    throw new DriverApiError(message ?? `Request failed (${res.status})`, res.status, body?.code);
  }
  return (await res.json()) as T;
}

export const driverGetRun = (token: string) => call<DriverRunView>(token, "/run");

export const driverSendCode = (token: string, stopId: number) =>
  call<{ sent: { email: boolean; whatsapp: boolean }; expiresInMinutes: number }>(token, `/stops/${stopId}/code`, {
    method: "POST",
  });

export const driverUploadPhoto = (token: string, stopId: number, file: File) => {
  const form = new FormData();
  form.append("photo", file);
  return call<{ hasPhoto: boolean }>(token, `/stops/${stopId}/photo`, { method: "POST", body: form });
};

export const driverDeliver = (token: string, stopId: number, body: { code?: string; cashCollected?: string }) =>
  call<{ status: string; runCompleted: boolean }>(token, `/stops/${stopId}/deliver`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const driverFail = (token: string, stopId: number, reason: string) =>
  call<{ status: string; runCompleted: boolean }>(token, `/stops/${stopId}/fail`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
