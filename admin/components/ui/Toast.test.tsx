import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "./Toast";

function Fire() {
  const toast = useToast();
  return <button onClick={() => toast("Saved")}>fire</button>;
}

afterEach(() => vi.useRealTimers());

describe("ToastProvider timers", () => {
  it("dismisses a toast after its duration", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Fire /></ToastProvider>);
    act(() => screen.getByText("fire").click());
    expect(screen.getByText("Saved")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("leaves no timer running after the provider unmounts", () => {
    vi.useFakeTimers();
    const { unmount } = render(<ToastProvider><Fire /></ToastProvider>);
    act(() => screen.getByText("fire").click());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
