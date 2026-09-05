import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useCountUp } from "./use-count-up";

// Same convention as use-scroll-value.test.tsx: stub rAF so a dispatched
// frame resolves synchronously. Here the callback receives an incrementing
// fake timestamp so a multi-frame animation fast-forwards to completion in
// one synchronous test tick instead of needing real timers.
let clock = 0;
function stubSyncRaf() {
  clock = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    clock += 16;
    cb(clock);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
}

// Copied from use-reduced-motion.test.ts's own test-local helper.
function stubMatchMedia(initial: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: initial,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function stubMotionDuration(ms: string) {
  document.documentElement.style.setProperty("--motion-duration-slow", ms);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty("--motion-duration-slow");
});

function Probe({ target, active, sink }: { target: number; active: boolean; sink: (v: number) => void }) {
  sink(useCountUp(target, active));
  return null;
}

describe("useCountUp", () => {
  it("returns target immediately when inactive, no rAF scheduled", () => {
    stubMatchMedia(false);
    stubMotionDuration("600ms");
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    let latest = -1;
    render(<Probe target={4.8} active={false} sink={(v) => (latest = v)} />);
    expect(latest).toBe(4.8);
    expect(raf).not.toHaveBeenCalled();
  });

  it("animates from 0 up to target and lands exactly on it once active", () => {
    stubMatchMedia(false);
    stubMotionDuration("64ms"); // 4 frames at the 16ms fake step
    stubSyncRaf();
    let latest = -1;
    render(<Probe target={4.8} active={true} sink={(v) => (latest = v)} />);
    expect(latest).toBe(4.8);
  });

  it("jumps straight to target under reduced motion, never dips to 0", () => {
    stubMatchMedia(true);
    stubMotionDuration("600ms");
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    let latest = -1;
    render(<Probe target={4.8} active={true} sink={(v) => (latest = v)} />);
    expect(latest).toBe(4.8);
    expect(raf).not.toHaveBeenCalled();
  });

  it("falls back to 600ms when --motion-duration-slow is unset", () => {
    stubMatchMedia(false);
    stubSyncRaf();
    let latest = -1;
    render(<Probe target={5} active={true} sink={(v) => (latest = v)} />);
    // With the 16ms-per-frame fake clock and a 600ms fallback duration, the
    // animation should still complete (not hang) within a bounded number of
    // synchronous frames.
    expect(latest).toBe(5);
  });

  it("removes its rAF loop on unmount (no update after)", () => {
    stubMatchMedia(false);
    stubMotionDuration("10000ms"); // long enough that it won't finish in one frame
    let frames = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames += 1;
      if (frames === 1) cb(16); // one frame in, then we unmount before frame 2
      return 1;
    });
    const cancelled = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelled);
    const seen: number[] = [];
    const { unmount } = render(<Probe target={4.8} active={true} sink={(v) => seen.push(v)} />);
    unmount();
    expect(cancelled).toHaveBeenCalled();
  });
});
