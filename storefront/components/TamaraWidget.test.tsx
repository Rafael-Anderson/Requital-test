import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import TamaraWidget from "./TamaraWidget";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { tamaraWidgetConfig?: unknown }).tamaraWidgetConfig;
});

const loadScriptOnce = vi.fn();
vi.mock("@/lib/load-script", () => ({
  loadScriptOnce: (...args: unknown[]) => loadScriptOnce(...args),
}));

const baseProps = {
  publicKey: "pk_test_456",
  price: "150.00",
  onLoadError: vi.fn(),
};

describe("TamaraWidget", () => {
  it("sets window.tamaraWidgetConfig and loads the real tamara-widget.js script, mounting a <tamara-widget> element", async () => {
    loadScriptOnce.mockResolvedValue(undefined);

    const { container } = render(<TamaraWidget {...baseProps} />);

    expect(window.tamaraWidgetConfig).toEqual({ lang: "en", country: "AE", publicKey: "pk_test_456" });
    expect(loadScriptOnce).toHaveBeenCalledWith("https://cdn.tamara.co/widget-v2/tamara-widget.js");

    await waitFor(() => expect(container.querySelector("tamara-widget")).not.toBeNull());
    const el = container.querySelector("tamara-widget")!;
    expect(el.getAttribute("type")).toBe("tamara-summary");
    expect(el.getAttribute("amount")).toBe("150.00");
  });

  it("uses a custom country when provided", () => {
    loadScriptOnce.mockResolvedValue(undefined);
    render(<TamaraWidget {...baseProps} country="SA" />);
    expect(window.tamaraWidgetConfig).toEqual({ lang: "en", country: "SA", publicKey: "pk_test_456" });
  });

  it("calls onLoadError and renders no fallback text when the script fails to load", async () => {
    loadScriptOnce.mockRejectedValue(new Error("network error"));
    const onLoadError = vi.fn();

    const { container } = render(<TamaraWidget {...baseProps} onLoadError={onLoadError} />);

    await waitFor(() => expect(onLoadError).toHaveBeenCalledTimes(1));
    expect(container.textContent).toBe("");
  });

  it("re-initializes when the price changes", async () => {
    loadScriptOnce.mockResolvedValue(undefined);
    const { container, rerender } = render(<TamaraWidget {...baseProps} />);
    await waitFor(() => expect(container.querySelector("tamara-widget")?.getAttribute("amount")).toBe("150.00"));

    rerender(<TamaraWidget {...baseProps} price="300.00" />);
    await waitFor(() => expect(container.querySelector("tamara-widget")?.getAttribute("amount")).toBe("300.00"));
  });
});
