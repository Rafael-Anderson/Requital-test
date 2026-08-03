import { describe, expect, it, vi, beforeEach } from "vitest";
import { forwardRef, useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MapPickerLeaflet from "./MapPickerLeaflet";
import { geocodeAddress, reverseGeocodeAddress } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  geocodeAddress: vi.fn(),
  reverseGeocodeAddress: vi.fn(),
}));

// jsdom has no real layout engine, so Leaflet's actual pointer-drag geometry
// (which depends on the map container's pixel size) can't be driven here —
// the same reason the task calls out that even Puppeteer can't drive a real
// canvas drag. Mocking react-leaflet lets these tests exercise our own glue
// code (the dragend/search handlers, the API calls they make, what they
// pass to onPick) deterministically; MapPickerLeaflet.test.tsx's sibling
// smoke assertions (leaflet-container/leaflet-marker-icon presence) already
// cover that the real library mounts correctly.
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

describe("MapPickerLeaflet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the search box and map", () => {
    render(<MapPickerLeaflet latitude={25.2} longitude={55.3} onPick={() => {}} />);
    expect(screen.getByPlaceholderText("Search an address")).toBeInTheDocument();
    expect(screen.getByTestId("map")).toBeInTheDocument();
  });

  it("falls back to the default UAE center when no coordinates are set yet", () => {
    // Renders without throwing when latitude/longitude are both null (a
    // brand-new outlet/address) — DEFAULT_CENTER covers the map's initial
    // view instead of crashing on a null position.
    render(<MapPickerLeaflet latitude={null} longitude={null} onPick={() => {}} />);
    expect(screen.getByTestId("map")).toBeInTheDocument();
  });

  it("search: forward-geocodes the typed query and reports the result to onPick", async () => {
    const user = userEvent.setup();
    vi.mocked(geocodeAddress).mockResolvedValue({
      latitude: 25.1972,
      longitude: 55.2744,
      displayName: "Burj Khalifa, Dubai",
    });
    const onPick = vi.fn();
    render(<MapPickerLeaflet latitude={null} longitude={null} onPick={onPick} />);

    await user.type(screen.getByPlaceholderText("Search an address"), "Burj Khalifa");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(onPick).toHaveBeenCalledWith({ latitude: 25.1972, longitude: 55.2744 }, "Burj Khalifa, Dubai");
    });
    expect(geocodeAddress).toHaveBeenCalledWith("Burj Khalifa");
  });

  it("search: a no-match result doesn't call onPick", async () => {
    const user = userEvent.setup();
    vi.mocked(geocodeAddress).mockResolvedValue(null);
    const onPick = vi.fn();
    render(<MapPickerLeaflet latitude={null} longitude={null} onPick={onPick} />);

    await user.type(screen.getByPlaceholderText("Search an address"), "zzznowhere");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(geocodeAddress).toHaveBeenCalled());
    expect(onPick).not.toHaveBeenCalled();
  });

  it("drag: updates coordinates immediately, then patches in the reverse-geocoded address", async () => {
    vi.mocked(reverseGeocodeAddress).mockResolvedValue("Dubai Mall, Dubai");
    const onPick = vi.fn();
    render(<MapPickerLeaflet latitude={25.2} longitude={55.3} onPick={onPick} />);

    await userEvent.setup().click(screen.getByTestId("marker"));

    // First call is immediate/synchronous — no snap-back while the reverse
    // geocode round trip is in flight.
    expect(onPick).toHaveBeenNthCalledWith(1, { latitude: 25.2, longitude: 55.3 }, null);
    expect(reverseGeocodeAddress).toHaveBeenCalledWith(25.2, 55.3);

    await waitFor(() => {
      expect(onPick).toHaveBeenNthCalledWith(2, { latitude: 25.2, longitude: 55.3 }, "Dubai Mall, Dubai");
    });
  });

  it("drag: a failed reverse-geocode still leaves the immediate coordinate update in place", async () => {
    vi.mocked(reverseGeocodeAddress).mockRejectedValue(new Error("network error"));
    const onPick = vi.fn();
    render(<MapPickerLeaflet latitude={25.2} longitude={55.3} onPick={onPick} />);

    await userEvent.setup().click(screen.getByTestId("marker"));

    expect(onPick).toHaveBeenCalledWith({ latitude: 25.2, longitude: 55.3 }, null);
    await waitFor(() => expect(reverseGeocodeAddress).toHaveBeenCalled());
    // No second call, and no thrown/unhandled rejection.
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});
