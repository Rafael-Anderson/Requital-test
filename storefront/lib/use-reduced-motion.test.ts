import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReducedMotion } from "./use-reduced-motion";

function stubMatchMedia(initial: boolean) {
  let matches = initial;
  let listener: (() => void) | null = null;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: vi.fn((_, cb) => (listener = cb)),
      removeEventListener: vi.fn(),
    })),
  });
  return {
    fireChange: (next: boolean) => {
      matches = next;
      listener?.();
    },
  };
}

describe("useReducedMotion", () => {
  it("returns the initial matchMedia value", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("returns false when reduced motion is not set", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("updates when the media query change fires", () => {
    const { fireChange } = stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => fireChange(true));
    expect(result.current).toBe(true);
  });
});
