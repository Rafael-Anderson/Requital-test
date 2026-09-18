import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import TabbyPromoWidget from "./TabbyPromoWidget";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { TabbyPromo?: unknown }).TabbyPromo;
});

const loadScriptOnce = vi.fn();
vi.mock("@/lib/load-script", () => ({
  loadScriptOnce: (...args: unknown[]) => loadScriptOnce(...args),
}));

const baseProps = {
  publicKey: "pk_test_123",
  merchantCode: "mc_test_123",
  price: "100.00",
  currency: "aed",
  onLoadError: vi.fn(),
};

describe("TabbyPromoWidget", () => {
  it("loads the real tabby-promo.js script and initializes TabbyPromo with the right config once loaded", async () => {
    loadScriptOnce.mockResolvedValue(undefined);
    const TabbyPromoCtor = vi.fn();
    window.TabbyPromo = TabbyPromoCtor as unknown as typeof window.TabbyPromo;

    render(<TabbyPromoWidget {...baseProps} />);

    await waitFor(() => expect(TabbyPromoCtor).toHaveBeenCalled());
    expect(loadScriptOnce).toHaveBeenCalledWith("https://checkout.tabby.ai/tabby-promo.js");
    expect(TabbyPromoCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: "#tabby-promo",
        currency: "AED", // uppercased, per Tabby's docs
        price: "100.00",
        publicKey: "pk_test_123",
        merchantCode: "mc_test_123",
      }),
    );
  });

  it("calls onLoadError and renders no fallback text when the script fails to load", async () => {
    loadScriptOnce.mockRejectedValue(new Error("network error"));
    const onLoadError = vi.fn();

    const { container } = render(<TabbyPromoWidget {...baseProps} onLoadError={onLoadError} />);

    await waitFor(() => expect(onLoadError).toHaveBeenCalledTimes(1));
    expect(container.textContent).toBe("");
  });

  it("re-initializes when the price changes", async () => {
    loadScriptOnce.mockResolvedValue(undefined);
    const TabbyPromoCtor = vi.fn();
    window.TabbyPromo = TabbyPromoCtor as unknown as typeof window.TabbyPromo;

    const { rerender } = render(<TabbyPromoWidget {...baseProps} />);
    await waitFor(() => expect(TabbyPromoCtor).toHaveBeenCalledTimes(1));

    rerender(<TabbyPromoWidget {...baseProps} price="200.00" />);
    await waitFor(() => expect(TabbyPromoCtor).toHaveBeenCalledTimes(2));
    expect(TabbyPromoCtor).toHaveBeenLastCalledWith(expect.objectContaining({ price: "200.00" }));
  });
});
