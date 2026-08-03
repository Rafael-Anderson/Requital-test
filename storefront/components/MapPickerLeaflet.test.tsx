import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { forwardRef, useEffect } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MapPickerLeaflet from "./MapPickerLeaflet";
import { geocode, reverseGeocode } from "@/lib/api";

// vitest.setup.ts doesn't register global afterEach(cleanup) for this app.
afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  geocode: vi.fn(),
  reverseGeocode: vi.fn(),
}));

// jsdom has no real layout engine, so Leaflet's actual pointer-drag geometry
// (which depends on the map container's pixel size) can't be driven here —
// the same reason the task calls out that even Puppeteer can't drive a real
// canvas drag. Mocking react-leaflet lets these tests exercise our own glue
// code (the dragend/search handlers, the API calls they make, what they
// pass to onPick) deterministically; MapPickerLeaflet.smoke.test.tsx covers
// that the real library mounts correctly.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  useMap: () => ({ setView: vi.fn(), getZoom: () => 11 }),
  Marker: forwardRef(function MockMarker(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { position, eventHandlers }: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ref: any,
  ) {
    useEffect(() => {
      const fakeMarker = { getLatLng: () => ({ lat: position[0], lng: position[1] }) };
      if (typeof ref === "function") ref(fakeMarker);
      else if (ref) ref.current = fakeMarker;
    }, [position, ref]);
    return (
      <button type="button" data-testid="marker" onClick={() => eventHandlers?.dragend?.()}>
        marker
      </button>
    );
  }),
}));

const SHOP_SLUG = "test-shop";

describe("MapPickerLeaflet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the search box and map", () => {
    render(<MapPickerLeaflet shopSlug={SHOP_SLUG} latitude={25.2} longitude={55.3} onPick={() => {}} />);
    expect(screen.getByPlaceholderText("Search an address")).toBeInTheDocument();
    expect(screen.getByTestId("map")).toBeInTheDocument();
  });

  it("falls back to the default UAE center when no coordinates are set yet", () => {
    render(<MapPickerLeaflet shopSlug={SHOP_SLUG} latitude={null} longitude={null} onPick={() => {}} />);
    expect(screen.getByTestId("map")).toBeInTheDocument();
  });

  it("search: forward-geocodes the typed query (scoped to the shop) and reports the result to onPick", async () => {
    const user = userEvent.setup();
    vi.mocked(geocode).mockResolvedValue({
      latitude: 25.1972,
      longitude: 55.2744,
      displayName: "Burj Khalifa, Dubai",
    });
    const onPick = vi.fn();
    render(<MapPickerLeaflet shopSlug={SHOP_SLUG} latitude={null} longitude={null} onPick={onPick} />);

    await user.type(screen.getByPlaceholderText("Search an address"), "Burj Khalifa");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(onPick).toHaveBeenCalledWith({ latitude: 25.1972, longitude: 55.2744 }, "Burj Khalifa, Dubai");
    });
    expect(geocode).toHaveBeenCalledWith(SHOP_SLUG, "Burj Khalifa");
  });

  it("search: a failed lookup doesn't call onPick or crash", async () => {
    const user = userEvent.setup();
    vi.mocked(geocode).mockRejectedValue(new Error("No location found"));
    const onPick = vi.fn();
    render(<MapPickerLeaflet shopSlug={SHOP_SLUG} latitude={null} longitude={null} onPick={onPick} />);

    await user.type(screen.getByPlaceholderText("Search an address"), "zzznowhere");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(geocode).toHaveBeenCalled());
    expect(onPick).not.toHaveBeenCalled();
  });

  it("drag: updates coordinates immediately, then patches in the reverse-geocoded address", async () => {
    vi.mocked(reverseGeocode).mockResolvedValue({ displayName: "Dubai Mall, Dubai" });
    const onPick = vi.fn();
    render(<MapPickerLeaflet shopSlug={SHOP_SLUG} latitude={25.2} longitude={55.3} onPick={onPick} />);

    await userEvent.setup().click(screen.getByTestId("marker"));

    // First call is immediate/synchronous — no snap-back while the reverse
    // geocode round trip is in flight.
    expect(onPick).toHaveBeenNthCalledWith(1, { latitude: 25.2, longitude: 55.3 }, null);
    expect(reverseGeocode).toHaveBeenCalledWith(SHOP_SLUG, 25.2, 55.3);

    await waitFor(() => {
      expect(onPick).toHaveBeenNthCalledWith(2, { latitude: 25.2, longitude: 55.3 }, "Dubai Mall, Dubai");
    });
  });

  it("drag: a failed reverse-geocode still leaves the immediate coordinate update in place", async () => {
    vi.mocked(reverseGeocode).mockRejectedValue(new Error("network error"));
    const onPick = vi.fn();
    render(<MapPickerLeaflet shopSlug={SHOP_SLUG} latitude={25.2} longitude={55.3} onPick={onPick} />);

    await userEvent.setup().click(screen.getByTestId("marker"));

    expect(onPick).toHaveBeenCalledWith({ latitude: 25.2, longitude: 55.3 }, null);
    await waitFor(() => expect(reverseGeocode).toHaveBeenCalled());
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});
