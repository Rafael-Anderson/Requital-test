import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DeliveryZoneMap, { UAE_CENTER } from "./DeliveryZoneMap";

let dragHandler: (() => void) | null = null;
let dragendHandler: (() => void) | null = null;
let clickHandler: ((e: google.maps.MapMouseEvent) => void) | null = null;
let lastMarkerPosition = UAE_CENTER;
const setRadiusSpy = vi.fn();
const setCenterSpy = vi.fn();

class FakeMap {
  setCenter = vi.fn();
  addListener(event: string, handler: (e: google.maps.MapMouseEvent) => void) {
    if (event === "click") clickHandler = handler;
  }
}

class FakeMarker {
  constructor(opts: { position: { lat: number; lng: number } }) {
    lastMarkerPosition = opts.position;
  }
  addListener(event: string, handler: () => void) {
    if (event === "drag") dragHandler = handler;
    if (event === "dragend") dragendHandler = handler;
  }
  getPosition() {
    return { lat: () => lastMarkerPosition.lat, lng: () => lastMarkerPosition.lng };
  }
  setPosition = vi.fn((pos: { lat: number; lng: number }) => {
    lastMarkerPosition = pos;
  });
}

class FakeCircle {
  setCenter = setCenterSpy;
  setRadius = setRadiusSpy;
}

vi.mock("@/lib/google-maps-loader", () => ({
  loadGoogleMaps: vi.fn(() =>
    Promise.resolve({
      maps: { Map: FakeMap, Marker: FakeMarker, Circle: FakeCircle },
    }),
  ),
}));

describe("DeliveryZoneMap", () => {
  it("renders and picks coordinates on marker dragend", async () => {
    const onChange = vi.fn();
    render(<DeliveryZoneMap center={UAE_CENTER} radiusKm={5} onChange={onChange} />);
    await waitFor(() => expect(dragendHandler).not.toBeNull());

    dragendHandler!();

    expect(onChange).toHaveBeenCalledWith(UAE_CENTER);
  });

  it("picks coordinates on map click", async () => {
    const onChange = vi.fn();
    render(<DeliveryZoneMap center={UAE_CENTER} radiusKm={5} onChange={onChange} />);
    await waitFor(() => expect(clickHandler).not.toBeNull());

    clickHandler!({ latLng: { lat: () => 24.1, lng: () => 55.7 } } as unknown as google.maps.MapMouseEvent);

    expect(onChange).toHaveBeenCalledWith({ lat: 24.1, lng: 55.7 });
  });

  it("updates the circle radius when radiusKm changes", async () => {
    const { rerender } = render(<DeliveryZoneMap center={UAE_CENTER} radiusKm={5} onChange={() => {}} />);
    await waitFor(() => expect(dragendHandler).not.toBeNull());

    rerender(<DeliveryZoneMap center={UAE_CENTER} radiusKm={20} onChange={() => {}} />);

    await waitFor(() => expect(setRadiusSpy).toHaveBeenCalledWith(20000));
  });

  it("shows a help hint below the map", async () => {
    render(<DeliveryZoneMap center={UAE_CENTER} radiusKm={5} onChange={() => {}} />);
    expect(screen.getByText(/click the map or drag the pin/i)).toBeInTheDocument();
  });
});
