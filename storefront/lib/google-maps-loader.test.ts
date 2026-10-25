import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMapsFailure,
  loadGoogleMaps,
  markMapsHealthy,
  parseMapsErrorCode,
  resetMapsFailureForTests,
  subscribeMapsFailure,
} from "./google-maps-loader";

// jsdom never loads the script, so the tests drive the same two signals the real
// Maps bundle produces: the script's own error event, and the console.error line
// it writes for a key / referrer / billing / API problem.
const nativeConsoleError = console.error;

beforeEach(() => {
  resetMapsFailureForTests();
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  delete (window as unknown as { google?: unknown }).google;
  // Keep the real error spy out of the test output, then let the loader patch it.
  console.error = vi.fn();
});

afterEach(() => {
  console.error = nativeConsoleError;
});

describe("parseMapsErrorCode", () => {
  it("extracts the four known codes from Google's console line", () => {
    for (const code of [
      "RefererNotAllowedMapError",
      "BillingNotEnabledMapError",
      "InvalidKeyMapError",
      "ApiNotActivatedMapError",
    ]) {
      expect(parseMapsErrorCode(`Google Maps JavaScript API error: ${code}\nhttps://developers.google.com/x`)).toBe(
        code,
      );
    }
  });

  it("returns null for an unrecognised Maps error and undefined for any other text", () => {
    expect(parseMapsErrorCode("Google Maps JavaScript API error: SomethingNewMapError")).toBeNull();
    expect(parseMapsErrorCode("TypeError: x is not a function")).toBeUndefined();
  });
});

describe("loadGoogleMaps failure signals", () => {
  it("reports a failure with no code and rejects when the script fails to load", async () => {
    const seen = vi.fn();
    subscribeMapsFailure(seen);
    const promise = loadGoogleMaps();
    const script = document.head.querySelector("script") as HTMLScriptElement;
    script.onerror?.(new Event("error"));
    await expect(promise).rejects.toThrow("Failed to load Google Maps");
    expect(getMapsFailure()).toEqual({ code: null });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("turns Google's console error into a failure carrying the parsed code, and still logs it", async () => {
    const original = console.error as ReturnType<typeof vi.fn>;
    void loadGoogleMaps();
    const seen = vi.fn();
    subscribeMapsFailure(seen);
    console.error("Google Maps JavaScript API error: RefererNotAllowedMapError\nhttps://x");
    expect(getMapsFailure()).toEqual({ code: "RefererNotAllowedMapError" });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledTimes(1);
  });

  it("ignores console errors that are not from Maps", () => {
    void loadGoogleMaps();
    console.error("Something else broke");
    console.error(new Error("not a string"));
    expect(getMapsFailure()).toBeNull();
  });

  it("keeps the named code when gm_authFailure fires first or second", () => {
    void loadGoogleMaps();
    const authFailure = (window as unknown as { gm_authFailure: () => void }).gm_authFailure;
    authFailure();
    expect(getMapsFailure()).toEqual({ code: null });
    console.error("Google Maps JavaScript API error: InvalidKeyMapError\nu");
    expect(getMapsFailure()).toEqual({ code: "InvalidKeyMapError" });
    authFailure();
    expect(getMapsFailure()).toEqual({ code: "InvalidKeyMapError" });
  });

  it("reports an unnamed Maps error without a code (never beaconed)", () => {
    void loadGoogleMaps();
    console.error("Google Maps JavaScript API error: BrandNewMapError\nu");
    expect(getMapsFailure()).toEqual({ code: null });
  });

  it("clears only a code-less failure once Maps proves healthy again", () => {
    void loadGoogleMaps();
    console.error("Google Maps JavaScript API error: BillingNotEnabledMapError\nu");
    markMapsHealthy();
    expect(getMapsFailure()).toEqual({ code: "BillingNotEnabledMapError" });
  });

  it("lets a subscriber unsubscribe", () => {
    void loadGoogleMaps();
    const seen = vi.fn();
    const off = subscribeMapsFailure(seen);
    off();
    console.error("Google Maps JavaScript API error: InvalidKeyMapError\nu");
    expect(seen).not.toHaveBeenCalled();
  });
});
