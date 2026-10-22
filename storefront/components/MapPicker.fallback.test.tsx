import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MapPicker, { MAPS_UNAVAILABLE_MESSAGE } from "./MapPicker";
import { resetMapsFailureForTests } from "@/lib/google-maps-loader";
import { resetMapsBeaconForTests } from "@/lib/maps-status";

// Real loader, real hook: only the network is faked. jsdom never fetches the Maps
// script, so a failure is driven through the same two signals the bundle gives.
const nativeConsoleError = console.error;
const fetchMock = vi.fn();

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}
function scriptElement() {
  return document.head.querySelector("script") as HTMLScriptElement;
}
function failScript() {
  act(() => {
    scriptElement().onerror?.(new Event("error"));
  });
}

beforeEach(() => {
  resetMapsFailureForTests();
  resetMapsBeaconForTests();
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  delete (window as unknown as { google?: unknown }).google;
  console.error = vi.fn();
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => ok({}));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  console.error = nativeConsoleError;
  vi.unstubAllGlobals();
});

describe("MapPicker when Google Maps is unavailable", () => {
  it("shows only our neutral message and hides the search box", async () => {
    render(<MapPicker latitude={null} longitude={null} onPick={() => {}} shopSlug="shop" />);
    failScript();
    const box = await screen.findByTestId("map-unavailable");
    expect(box).toHaveTextContent(MAPS_UNAVAILABLE_MESSAGE);
    expect(screen.queryByPlaceholderText("Search an address")).toBeNull();
    // Never Google's words, never the merchant's problem, never an em dash.
    expect(box.textContent).not.toMatch(/google|api key|billing|referrer|referer|—/i);
  });

  it("stays neutral for a named Google error and tells the backend once, with only the code and host", async () => {
    const { rerender } = render(<MapPicker latitude={null} longitude={null} onPick={() => {}} shopSlug="shop" />);
    act(() => {
      console.error("Google Maps JavaScript API error: RefererNotAllowedMapError\nhttps://shop.example/");
    });
    const box = await screen.findByTestId("map-unavailable");
    expect(box.textContent).not.toMatch(/google|key|billing|referrer|referer|RefererNotAllowedMapError/i);
    rerender(<MapPicker latitude={null} longitude={null} onPick={() => {}} shopSlug="shop" addressQuery="x" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/public/shop/maps-error");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(JSON.parse(init.body as string)).toEqual({
      code: "RefererNotAllowedMapError",
      host: window.location.host,
    });
  });

  it("does not beacon a failure that carries no named code", async () => {
    render(<MapPicker latitude={null} longitude={null} onPick={() => {}} shopSlug="shop" />);
    failScript();
    await screen.findByTestId("map-unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Find on map looks the typed address up once per press and sets the coordinates", async () => {
    fetchMock.mockImplementation(() => ok({ latitude: 25.2, longitude: 55.3, displayName: "Jumeirah 1, Dubai" }));
    const onPick = vi.fn();
    render(
      <MapPicker latitude={null} longitude={null} onPick={onPick} shopSlug="shop" addressQuery="Villa 12, Jumeirah 1" />,
    );
    failScript();
    const button = await screen.findByRole("button", { name: "Find on map" });
    expect(fetchMock).not.toHaveBeenCalled(); // never on its own, never while typing
    fireEvent.click(button);

    await screen.findByTestId("map-found");
    expect(screen.getByTestId("map-found")).toHaveTextContent("Location found: Jumeirah 1, Dubai");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/public/shop/geocode?q=Villa%2012%2C%20Jumeirah%201");
    expect(onPick).toHaveBeenCalledWith({ latitude: 25.2, longitude: 55.3 }, null);
  });

  it("keeps Find on map disabled until there is an address to look up", async () => {
    render(<MapPicker latitude={null} longitude={null} onPick={() => {}} shopSlug="shop" addressQuery="ab" />);
    failScript();
    const button = await screen.findByRole("button", { name: "Find on map" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says so in our words when the lookup finds nothing", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ message: "No location found" }) }),
    );
    const onPick = vi.fn();
    render(<MapPicker latitude={null} longitude={null} onPick={onPick} shopSlug="shop" addressQuery="nowhere at all" />);
    failScript();
    fireEvent.click(await screen.findByRole("button", { name: "Find on map" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not find that address. Check it and try again.");
    expect(onPick).not.toHaveBeenCalled();
  });
});
