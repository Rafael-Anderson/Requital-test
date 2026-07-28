import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureReferralFromUrl, getStoredReferralCode } from "./referral";

function setUrl(search: string) {
  window.history.replaceState({}, "", `/shop-a${search}`);
}

describe("referral capture/persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    setUrl("");
  });

  it("captures ?ref=<code> from the URL and makes it readable for that shop", () => {
    setUrl("?ref=ABC123");
    captureReferralFromUrl("shop-a");
    expect(getStoredReferralCode("shop-a")).toBe("ABC123");
  });

  it("a page load with no ?ref param leaves an earlier-captured code untouched", () => {
    setUrl("?ref=ABC123");
    captureReferralFromUrl("shop-a");
    setUrl("");
    captureReferralFromUrl("shop-a");
    expect(getStoredReferralCode("shop-a")).toBe("ABC123");
  });

  it("is namespaced per shop — a code captured for one shop isn't visible under another", () => {
    setUrl("?ref=ABC123");
    captureReferralFromUrl("shop-a");
    expect(getStoredReferralCode("shop-b")).toBeNull();
  });

  it("returns null once the stored code has expired, and cleans up after itself", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    setUrl("?ref=ABC123");
    captureReferralFromUrl("shop-a");

    vi.spyOn(Date, "now").mockReturnValue(now + 31 * 24 * 60 * 60 * 1000);
    expect(getStoredReferralCode("shop-a")).toBeNull();
    expect(localStorage.getItem("requital_ref:shop-a")).toBeNull();

    vi.restoreAllMocks();
  });

  it("returns null when nothing was ever captured", () => {
    expect(getStoredReferralCode("shop-a")).toBeNull();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
