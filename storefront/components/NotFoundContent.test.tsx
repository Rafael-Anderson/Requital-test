import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import NotFoundContent, { loggedPath } from "./NotFoundContent";

const reportNotFound = vi.fn();
let shopValue: Record<string, unknown>;

vi.mock("@/lib/shop-context", () => ({ useShop: () => shopValue }));
vi.mock("@/lib/api", () => ({ reportNotFound: (...args: unknown[]) => reportNotFound(...args) }));

beforeEach(() => {
  reportNotFound.mockClear();
  window.sessionStorage.clear();
  shopValue = { shopSlug: "roses", shopBasePath: "", previewMode: false };
  window.history.pushState({}, "", "/old/page?email=a%40b.com#x");
});
afterEach(cleanup);

describe("loggedPath", () => {
  it("strips the /<shop> prefix only when the request arrived by path", () => {
    expect(loggedPath("/roses/old/page", "/roses")).toBe("/old/page");
    expect(loggedPath("/roses", "/roses")).toBe("/");
    expect(loggedPath("/old/page", "")).toBe("/old/page");
    expect(loggedPath("/roses-and-more/x", "/roses")).toBe("/roses-and-more/x");
  });
});

describe("NotFoundContent", () => {
  it("renders the not-found state and reports the path (no query string) once per tab", () => {
    const { rerender } = render(<NotFoundContent />);
    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(reportNotFound).toHaveBeenCalledTimes(1);
    expect(reportNotFound).toHaveBeenCalledWith("roses", "/old/page", "");
    rerender(<NotFoundContent />);
    cleanup();
    render(<NotFoundContent />);
    expect(reportNotFound).toHaveBeenCalledTimes(1);
  });

  it("does not report from the theme builder preview", () => {
    shopValue = { shopSlug: "roses", shopBasePath: "", previewMode: true };
    render(<NotFoundContent />);
    expect(reportNotFound).not.toHaveBeenCalled();
  });
});
