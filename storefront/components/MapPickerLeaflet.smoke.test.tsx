import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import MapPickerLeaflet from "./MapPickerLeaflet";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  geocode: vi.fn(),
  reverseGeocode: vi.fn(),
}));

// Unlike MapPickerLeaflet.test.tsx (which mocks react-leaflet to test our
// own glue code), this renders the *real* Leaflet + react-leaflet stack —
// the thing worth regression-testing here is specifically the marker-icon
// fix (the classic Leaflet+bundler breakage: default icon URLs resolve to
// nothing without it) and that the map/tile layer mount at all.
describe("MapPickerLeaflet (real Leaflet, no mocks)", () => {
  it("mounts a real Leaflet map with a visible pin using the patched icon assets", () => {
    const { container } = render(
      <MapPickerLeaflet shopSlug="test-shop" latitude={25.2048} longitude={55.2708} onPick={() => {}} />,
    );

    expect(container.querySelector(".leaflet-container")).not.toBeNull();

    const icon = container.querySelector(".leaflet-marker-icon");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("src", "/leaflet/marker-icon.png");

    const tile = container.querySelector(".leaflet-tile");
    expect(tile).not.toBeNull();
    // CARTO Voyager, not the standard OSM raster tiles — see
    // MapPickerLeaflet.tsx's TILE_URL comment (Latin/English labels
    // regardless of browser/OS locale).
    expect(tile?.getAttribute("src")).toMatch(/^https:\/\/[abcd]\.basemaps\.cartocdn\.com\/rastertiles\/voyager\//);

    const attribution = container.querySelector(".leaflet-control-attribution");
    expect(attribution?.textContent).toContain("OpenStreetMap");
    expect(attribution?.textContent).toContain("CARTO");
  });
});
