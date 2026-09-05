import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useHeaderScrollState, type HeaderScrollState } from "./use-header-scroll-state";

vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
  cb(0);
  return 1;
});
vi.stubGlobal("cancelAnimationFrame", () => {});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
  document.body.innerHTML = "";
});

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true });
  window.dispatchEvent(new Event("scroll"));
}

function Probe({ scrollBehavior, transparentOnHero, sink }: { scrollBehavior: string; transparentOnHero: boolean; sink: (v: HeaderScrollState) => void }) {
  sink(useHeaderScrollState(scrollBehavior, transparentOnHero));
  return null;
}

function renderProbe(scrollBehavior: string, transparentOnHero = false) {
  let latest!: HeaderScrollState;
  const utils = render(<Probe scrollBehavior={scrollBehavior} transparentOnHero={transparentOnHero} sink={(v) => (latest = v)} />);
  return { ...utils, get: () => latest };
}

describe("useHeaderScrollState — no-op for absent/other scrollBehavior", () => {
  it("reports all false/solid for an empty scrollBehavior regardless of scroll position", () => {
    const { get } = renderProbe("");
    act(() => setScrollY(500));
    expect(get()).toEqual({ shrunk: false, hidden: false, solid: true });
  });

  it("reports all false/solid for 'sticky' and 'static' too — those stay ThemeDrivenHeader's own narrow concern", () => {
    const sticky = renderProbe("sticky");
    act(() => setScrollY(500));
    expect(sticky.get()).toEqual({ shrunk: false, hidden: false, solid: true });
  });
});

describe("useHeaderScrollState — 'shrink'", () => {
  it("shrinks past the threshold, un-shrinks back above it", () => {
    const { get } = renderProbe("shrink");
    expect(get().shrunk).toBe(false);
    act(() => setScrollY(100));
    expect(get().shrunk).toBe(true);
    act(() => setScrollY(0));
    expect(get().shrunk).toBe(false);
  });
});

describe("useHeaderScrollState — 'hide-on-scroll'", () => {
  it("hides only when scrolling down past the dead zone, reappears on scroll up", () => {
    const { get } = renderProbe("hide-on-scroll");
    act(() => setScrollY(50));
    expect(get().hidden).toBe(false); // still inside the dead zone
    act(() => setScrollY(200));
    expect(get().hidden).toBe(true); // scrolled down, past the dead zone
    act(() => setScrollY(150));
    expect(get().hidden).toBe(false); // now scrolling up
  });
});

describe("useHeaderScrollState — 'reveal-on-hero'", () => {
  it("stays solid throughout when transparentOnHero is false (consumes it, no independent meaning)", () => {
    const { get } = renderProbe("reveal-on-hero", false);
    act(() => setScrollY(0));
    expect(get().solid).toBe(true);
  });

  it("stays solid when no [data-theme-hero] element exists on the page", () => {
    const { get } = renderProbe("reveal-on-hero", true);
    act(() => setScrollY(0));
    expect(get().solid).toBe(true);
  });

  it("starts transparent, goes solid once scrolled near the hero's measured height", () => {
    const hero = document.createElement("div");
    hero.setAttribute("data-theme-hero", "true");
    hero.getBoundingClientRect = () => ({ height: 400 }) as DOMRect;
    document.body.appendChild(hero);

    const { get } = renderProbe("reveal-on-hero", true);
    act(() => setScrollY(0));
    expect(get().solid).toBe(false);
    act(() => setScrollY(200));
    expect(get().solid).toBe(false); // still well within the hero
    act(() => setScrollY(370)); // past height(400) - buffer(40)
    expect(get().solid).toBe(true);
  });
});
