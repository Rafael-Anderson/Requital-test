import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useScrollValue, type ScrollValue } from "./use-scroll-value";

// Run rAF synchronously so a dispatched scroll event resolves in the same tick.
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
  cb(0);
  return 1;
});
vi.stubGlobal("cancelAnimationFrame", () => {});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
});

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true });
}

function Probe({ sink }: { sink: (v: ScrollValue) => void }) {
  sink(useScrollValue());
  return null;
}

describe("useScrollValue", () => {
  it("starts at window.scrollY with direction 'none'", () => {
    setScrollY(120);
    let latest: ScrollValue | null = null;
    render(<Probe sink={(v) => (latest = v)} />);
    expect(latest).toEqual({ y: 120, direction: "none" });
  });

  it("updates y and direction on scroll", () => {
    setScrollY(0);
    let latest: ScrollValue | null = null;
    render(<Probe sink={(v) => (latest = v)} />);

    act(() => {
      setScrollY(400);
      window.dispatchEvent(new Event("scroll"));
    });
    expect(latest).toEqual({ y: 400, direction: "down" });

    act(() => {
      setScrollY(150);
      window.dispatchEvent(new Event("scroll"));
    });
    expect(latest).toEqual({ y: 150, direction: "up" });
  });

  it("removes its listener on unmount (no update after)", () => {
    const seen: ScrollValue[] = [];
    const { unmount } = render(<Probe sink={(v) => seen.push(v)} />);
    unmount();
    act(() => {
      setScrollY(999);
      window.dispatchEvent(new Event("scroll"));
    });
    expect(seen.some((v) => v.y === 999)).toBe(false);
  });

  // §8.7 item 2 regression — found via the header-scrollBehavior scratch-shop
  // pass: a headless/unfocused browser tab's rAF callback for this listener
  // can simply never fire, silently freezing every consumer mid-scroll (this
  // hook's only real consumer before this batch, BackToTopButton, had never
  // been exercised with a real scroll either, so the bug went unnoticed
  // until now). The setTimeout fallback races against rAF so the value still
  // updates even when rAF is starved.
  it("still updates via the setTimeout fallback when requestAnimationFrame never calls back (starved rAF)", () => {
    vi.useFakeTimers();
    // Simulate a starved rAF: scheduled, but its callback is never invoked
    // (unlike the file-level stub above, which calls back synchronously).
    vi.stubGlobal("requestAnimationFrame", () => 1);

    setScrollY(0);
    let latest: ScrollValue | null = null;
    render(<Probe sink={(v) => (latest = v)} />);

    act(() => {
      setScrollY(500);
      window.dispatchEvent(new Event("scroll"));
    });
    // rAF never fired, so nothing has updated yet.
    expect(latest).toEqual({ y: 0, direction: "none" });

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(latest).toEqual({ y: 500, direction: "down" });

    vi.useRealTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
  });
});
