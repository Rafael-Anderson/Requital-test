import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import MapPicker from "./MapPicker";

afterEach(cleanup);

// Fake enough of the google.maps surface for MapPicker's own logic (marker
// drag -> reverse geocode, autocomplete place_changed -> pick) without
// pulling in the real Maps JS API in tests.
let dragendHandler: (() => void) | null = null;
let placeChangedHandler: (() => void) | null = null;
let lastMarkerPosition = { lat: 25.2, lng: 55.3 };
let lastPlace: google.maps.places.PlaceResult = {};

class FakeMap {
  setCenter = vi.fn();
  setZoom = vi.fn();
  getZoom = vi.fn(() => 14);
}

class FakeMarker {
  constructor(opts: { position: { lat: number; lng: number } }) {
    lastMarkerPosition = opts.position;
  }
  addListener(event: string, handler: () => void) {
    if (event === "dragend") dragendHandler = handler;
  }
  getPosition() {
    return { lat: () => lastMarkerPosition.lat, lng: () => lastMarkerPosition.lng };
  }
  setPosition = vi.fn();
}

class FakeGeocoder {
  geocode(
    _req: unknown,
    callback: (results: google.maps.GeocoderResult[] | null, status: string) => void,
  ) {
    callback([{ formatted_address: "Reverse Geocoded Address" } as google.maps.GeocoderResult], "OK");
  }
}

class FakeAutocomplete {
  addListener(event: string, handler: () => void) {
    if (event === "place_changed") placeChangedHandler = handler;
  }
  getPlace() {
    return lastPlace;
  }
}

vi.mock("@/lib/google-maps-loader", () => ({
  loadGoogleMaps: vi.fn(() =>
    Promise.resolve({
      maps: {
        Map: FakeMap,
        Marker: FakeMarker,
        Geocoder: FakeGeocoder,
        places: { Autocomplete: FakeAutocomplete },
      },
    }),
  ),
}));

describe("MapPicker", () => {
  it("renders the search input and map container", async () => {
    render(<MapPicker latitude={25.2} longitude={55.3} onPick={() => {}} />);
    expect(screen.getByPlaceholderText("Search an address")).toBeInTheDocument();
    await waitFor(() => expect(dragendHandler).not.toBeNull());
  });

  it("picks immediately on drag then patches in the reverse-geocoded address", async () => {
    const onPick = vi.fn();
    render(<MapPicker latitude={25.2} longitude={55.3} onPick={onPick} />);
    await waitFor(() => expect(dragendHandler).not.toBeNull());

    dragendHandler!();

    expect(onPick).toHaveBeenNthCalledWith(1, { latitude: 25.2, longitude: 55.3 }, null);
    await waitFor(() =>
      expect(onPick).toHaveBeenNthCalledWith(2, { latitude: 25.2, longitude: 55.3 }, "Reverse Geocoded Address"),
    );
  });

  it("picks the selected place on autocomplete place_changed", async () => {
    const onPick = vi.fn();
    lastPlace = {
      geometry: { location: { lat: () => 24.5, lng: () => 54.4 } } as google.maps.places.PlaceResult["geometry"],
      formatted_address: "Autocompleted Place",
    };
    render(<MapPicker latitude={null} longitude={null} onPick={onPick} />);
    await waitFor(() => expect(placeChangedHandler).not.toBeNull());

    placeChangedHandler!();

    expect(onPick).toHaveBeenCalledWith({ latitude: 24.5, longitude: 54.4 }, "Autocompleted Place");
  });
});
