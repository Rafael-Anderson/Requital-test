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
});
