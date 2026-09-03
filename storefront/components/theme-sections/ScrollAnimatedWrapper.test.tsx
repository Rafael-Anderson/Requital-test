import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import ScrollAnimatedWrapper from "./ScrollAnimatedWrapper";
import type { ResolvedSectionMotion } from "@/lib/section-motion";

// jsdom has no IntersectionObserver — a controllable stub so tests can drive
// intersection on/off explicitly.
let ioInstances: Array<{ cb: IntersectionObserverCallback; el: Element | null }>;

class FakeIO {
  cb: IntersectionObserverCallback;
  el: Element | null = null;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    ioInstances.push(this);
  }
  observe(el: Element) {
    this.el = el;
  }
  unobserve() {
    this.el = null;
  }
  disconnect() {
    this.el = null;
  }
}

function fireIntersect(isIntersecting: boolean) {
  act(() => {
    for (const io of ioInstances) {
      if (io.el || isIntersecting) {
        io.cb([{ isIntersecting } as IntersectionObserverEntry], io as unknown as IntersectionObserver);
      }
    }
  });
}

const M = (over: Partial<ResolvedSectionMotion>): ResolvedSectionMotion => ({
  entrance: "none",
  stagger: false,
  animateOnce: true,
  trigger: "scroll",
  ...over,
});

beforeEach(() => {
  ioInstances = [];
  vi.stubGlobal("IntersectionObserver", FakeIO);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ScrollAnimatedWrapper", () => {
  it("entrance 'none' renders children untouched (no wrapper div, no observer)", () => {
    const { container } = render(
      <ScrollAnimatedWrapper motion={M({ entrance: "none" })}>
        <p data-testid="c">hi</p>
      </ScrollAnimatedWrapper>,
    );
    expect(container.querySelector("[class*='theme-anim']")).toBeNull();
    expect(ioInstances).toHaveLength(0);
  });

  it("maps a new entrance value to its class and toggles theme-anim-visible on intersect", () => {
    const { container } = render(
      <ScrollAnimatedWrapper motion={M({ entrance: "blur-in" })}>
        <p>hi</p>
      </ScrollAnimatedWrapper>,
    );
    const wrap = container.querySelector(".theme-anim-blur-in")!;
    expect(wrap).toBeTruthy();
    expect(wrap.classList.contains("theme-anim-visible")).toBe(false);
    fireIntersect(true);
    expect(wrap.classList.contains("theme-anim-visible")).toBe(true);
  });

  it("stagger stamps data-stagger", () => {
    const { container } = render(
      <ScrollAnimatedWrapper motion={M({ entrance: "fade-in", stagger: true })}>
        <p>hi</p>
      </ScrollAnimatedWrapper>,
    );
    expect(container.querySelector(".theme-anim-fade-in")!.getAttribute("data-stagger")).toBe("true");
  });

  it("animateOnce (default) stops observing after the first reveal — never re-hides", () => {
    const { container } = render(
      <ScrollAnimatedWrapper motion={M({ entrance: "fade-in", animateOnce: true })}>
        <p>hi</p>
      </ScrollAnimatedWrapper>,
    );
    const wrap = container.querySelector(".theme-anim-fade-in")!;
    fireIntersect(true);
    expect(wrap.classList.contains("theme-anim-visible")).toBe(true);
    fireIntersect(false);
    expect(wrap.classList.contains("theme-anim-visible")).toBe(true);
  });

  it("animateOnce:false re-hides when the section scrolls back out", () => {
    const { container } = render(
      <ScrollAnimatedWrapper motion={M({ entrance: "fade-in", animateOnce: false })}>
        <p>hi</p>
      </ScrollAnimatedWrapper>,
    );
    const wrap = container.querySelector(".theme-anim-fade-in")!;
    fireIntersect(true);
    expect(wrap.classList.contains("theme-anim-visible")).toBe(true);
    fireIntersect(false);
    expect(wrap.classList.contains("theme-anim-visible")).toBe(false);
  });

  it("trigger 'load' reveals without an observer", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    const { container } = render(
      <ScrollAnimatedWrapper motion={M({ entrance: "slide-up", trigger: "load" })}>
        <p>hi</p>
      </ScrollAnimatedWrapper>,
    );
    expect(ioInstances).toHaveLength(0);
    expect(container.querySelector(".theme-anim-slide-up")!.classList.contains("theme-anim-visible")).toBe(true);
  });
});
