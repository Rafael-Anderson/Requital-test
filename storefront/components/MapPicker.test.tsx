import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import MapPicker from "./MapPicker";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  geocode: vi.fn(),
  reverseGeocode: vi.fn(),
}));

// MapPicker itself is just the ssr:false dynamic-import wrapper (see its own
// file comment for why) — the real behavior is covered by
// MapPickerLeaflet.test.tsx/.smoke.test.tsx. This just confirms the wrapper
// actually resolves to the real map, always, with no key/env gating left.
describe("MapPicker", () => {
  it("renders the map (no env var gating — always on)", async () => {
    render(<MapPicker shopSlug="test-shop" latitude={25.2} longitude={55.3} onPick={() => {}} />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search an address")).toBeInTheDocument();
    });
  });
});
