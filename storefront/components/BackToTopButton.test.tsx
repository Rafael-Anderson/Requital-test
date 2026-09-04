import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import BackToTopButton from "./BackToTopButton";

vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
  cb(0);
  return 1;
});
vi.stubGlobal("cancelAnimationFrame", () => {});
vi.stubGlobal(
  "matchMedia",
  vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);

let themeConfig: unknown = null;
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ themeConfig }),
}));

afterEach(() => {
  cleanup();
  themeConfig = null;
  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
});

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true });
  window.dispatchEvent(new Event("scroll"));
}

describe("BackToTopButton", () => {
  it("renders nothing when floatingElements.backToTop is unset (byte-identical no-op)", () => {
    themeConfig = { globalSettings: { floatingElements: undefined } };
    setScrollY(1000);
    const { container } = render(<BackToTopButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when enabled but not scrolled past the threshold", () => {
    themeConfig = { globalSettings: { floatingElements: { backToTop: { enabled: true } } } };
    setScrollY(100);
    const { container } = render(<BackToTopButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders once enabled and scrolled past the threshold", () => {
    themeConfig = { globalSettings: { floatingElements: { backToTop: { enabled: true } } } };
    setScrollY(0);
    render(<BackToTopButton />);
    act(() => setScrollY(1000));
    expect(screen.getByRole("button", { name: "Back to top" })).toBeInTheDocument();
  });

  it("stays hidden past the threshold when backToTop.enabled is false", () => {
    themeConfig = { globalSettings: { floatingElements: { backToTop: { enabled: false } } } };
    setScrollY(1000);
    const { container } = render(<BackToTopButton />);
    expect(container).toBeEmptyDOMElement();
  });
});
