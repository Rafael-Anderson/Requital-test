import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import ScrollProgressBar from "./ScrollProgressBar";

vi.stubGlobal("matchMedia", vi.fn().mockImplementation((q: string) => ({
  matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
})));
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
vi.stubGlobal("cancelAnimationFrame", () => {});

let themeConfig: unknown = null;
vi.mock("@/lib/shop-context", () => ({ useShop: () => ({ themeConfig }) }));

afterEach(() => {
  cleanup();
  themeConfig = null;
  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
});

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true });
  window.dispatchEvent(new Event("scroll"));
}

describe("ScrollProgressBar (§8.13.C item 14)", () => {
  it("renders nothing when motion.scrollProgressBar is unset (no-op)", () => {
    themeConfig = { globalSettings: { motion: {} } };
    const { container } = render(<ScrollProgressBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when themeConfig has no motion", () => {
    themeConfig = { globalSettings: {} };
    const { container } = render(<ScrollProgressBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the bar; the fill appears only once scrolled and scales with depth", () => {
    themeConfig = { globalSettings: { motion: { scrollProgressBar: true } } };
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
    const { container } = render(<ScrollProgressBar />);
    // The outer bar container is always present…
    expect(container.querySelector(".fixed.inset-x-0.top-0")).not.toBeNull();
    // …but at rest (pct ~ 0) the accent fill is not painted at all — no
    // stray full-width line across the top of the page.
    expect(container.querySelector(".origin-left")).toBeNull();
    act(() => setScrollY(500)); // halfway through the 1000px scrollable range
    expect((container.querySelector(".origin-left") as HTMLElement).style.transform).toBe("scaleX(0.5)");
    act(() => setScrollY(0));
    expect(container.querySelector(".origin-left")).toBeNull();
  });
});
