import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import DeliveryAddressFields from "./DeliveryAddressFields";
import { resetMapsFailureForTests } from "@/lib/google-maps-loader";
import { resetMapsBeaconForTests } from "@/lib/maps-status";
import type { CheckoutFormState } from "@/lib/useCheckoutForm";

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ regions: [{ id: 2, code: "AE-DU", nameEn: "Dubai", nameAr: "x", sortOrder: 1 }], regionLabel: "Emirate" }),
}));

const nativeConsoleError = console.error;
const fetchMock = vi.fn();

function state(over: Record<string, unknown> = {}) {
  return {
    shopSlug: "shop",
    customerAddress: "Villa 12, Street 4",
    setCustomerAddress: vi.fn(),
    regionId: 2,
    setRegionId: vi.fn(),
    area: "Jumeirah 1",
    setArea: vi.fn(),
    coords: null,
    setCoords: vi.fn(),
    locating: false,
    useMyLocation: vi.fn(),
    savedAddresses: [],
    applySavedAddress: vi.fn(),
    ...over,
  } as unknown as CheckoutFormState;
}

beforeEach(() => {
  resetMapsFailureForTests();
  resetMapsBeaconForTests();
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  delete (window as unknown as { google?: unknown }).google;
  console.error = vi.fn();
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ latitude: 25.2, longitude: 55.3, displayName: "Found" }) }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  console.error = nativeConsoleError;
  vi.unstubAllGlobals();
});

describe("DeliveryAddressFields with Google Maps blocked", () => {
  it("keeps Use my location and the typed address, and offers Find on map with region and area in the lookup", async () => {
    const s = state();
    render(<DeliveryAddressFields state={s} />);
    act(() => {
      (document.head.querySelector("script") as HTMLScriptElement).onerror?.(new Event("error"));
    });
    await screen.findByTestId("map-unavailable");

    // Geolocation does not depend on Maps.
    fireEvent.click(screen.getByRole("button", { name: /Use my location/ }));
    expect(s.useMyLocation).toHaveBeenCalledTimes(1);
    // The typed address field is still there and required.
    const address = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(address).toBeRequired();
    fireEvent.change(address, { target: { value: "Villa 13" } });
    expect(s.setCustomerAddress).toHaveBeenCalledWith("Villa 13");

    fireEvent.click(screen.getByRole("button", { name: "Find on map" }));
    await screen.findByTestId("map-found");
    expect(decodeURIComponent(fetchMock.mock.calls[0][0] as string)).toBe(
      "/api/public/shop/geocode?q=Villa 12, Street 4, Jumeirah 1, Dubai",
    );
    expect(s.setCoords).toHaveBeenCalledWith({ latitude: 25.2, longitude: 55.3 });
  });
});

describe("DeliveryAddressFields pin follows the typed address", () => {
  const pin = { latitude: 25.2, longitude: 55.3 };

  it("clears a placed pin when the shopper edits the address by hand, and says so", () => {
    const s = state({ coords: pin });
    const { rerender } = render(<DeliveryAddressFields state={s} />);
    const address = document.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(address, { target: { value: "Villa 99, Street 4" } });
    expect(s.setCustomerAddress).toHaveBeenCalledWith("Villa 99, Street 4");
    expect(s.setCoords).toHaveBeenCalledWith(null);
    // The parent re-renders with the cleared pin: the hint explains why.
    rerender(<DeliveryAddressFields state={state({ coords: null, setCoords: s.setCoords })} />);
    expect(screen.getByRole("status").textContent).toMatch(/pin was cleared/);
  });

  it("leaves coords alone when there was no pin, and when the map itself sets the address", () => {
    const s = state({ coords: null });
    render(<DeliveryAddressFields state={s} />);
    fireEvent.change(document.querySelector("textarea") as HTMLTextAreaElement, { target: { value: "Villa 5" } });
    expect(s.setCoords).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
