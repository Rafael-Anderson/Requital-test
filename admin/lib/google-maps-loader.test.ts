import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMapsFailure,
  loadGoogleMaps,
  parseMapsErrorCode,
  resetMapsFailureForTests,
  subscribeMapsFailure,
} from "./google-maps-loader";

const nativeConsoleError = console.error;

beforeEach(() => {
  resetMapsFailureForTests();
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  delete (window as unknown as { google?: unknown }).google;
  console.error = vi.fn();
});
afterEach(() => {
  console.error = nativeConsoleError;
});

describe("parseMapsErrorCode", () => {
  it("extracts the four known codes and flags unknown ones", () => {
    for (const code of [
      "RefererNotAllowedMapError",
      "BillingNotEnabledMapError",
      "InvalidKeyMapError",
      "ApiNotActivatedMapError",
    ]) {
      expect(parseMapsErrorCode(`Google Maps JavaScript API error: ${code}\nhttps://x`)).toBe(code);
    }
    expect(parseMapsErrorCode("Google Maps JavaScript API error: NewMapError")).toBeNull();
    expect(parseMapsErrorCode("unrelated")).toBeUndefined();
  });
});

describe("loadGoogleMaps failure signals", () => {
  it("rejects and publishes a code-less failure when the script errors", async () => {
    const seen = vi.fn();
    subscribeMapsFailure(seen);
    const promise = loadGoogleMaps();
    (document.head.querySelector("script") as HTMLScriptElement).onerror?.(new Event("error"));
    await expect(promise).rejects.toThrow("Failed to load Google Maps");
    expect(getMapsFailure()).toEqual({ code: null });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("publishes the parsed code from Google's console error, still logs it, and runs the caller's callback", () => {
    const original = console.error as ReturnType<typeof vi.fn>;
    const onAuthFailure = vi.fn();
    void loadGoogleMaps(onAuthFailure);
    console.error("Google Maps JavaScript API error: BillingNotEnabledMapError\nhttps://x");
    expect(getMapsFailure()).toEqual({ code: "BillingNotEnabledMapError" });
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledTimes(1);
  });

  it("publishes a code-less failure from gm_authFailure and keeps a later named code", () => {
    void loadGoogleMaps();
    (window as unknown as { gm_authFailure: () => void }).gm_authFailure();
    expect(getMapsFailure()).toEqual({ code: null });
    console.error("Google Maps JavaScript API error: InvalidKeyMapError\nu");
    expect(getMapsFailure()).toEqual({ code: "InvalidKeyMapError" });
  });

  it("ignores console errors that are not from Maps", () => {
    void loadGoogleMaps();
    console.error("Something else", { a: 1 });
    expect(getMapsFailure()).toBeNull();
  });
});
