import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TrackOrderPage from "./page";

const lookupOrder = vi.fn();
const tokenInUrl = vi.hoisted(() => ({ value: "" }));
vi.mock("@/lib/api", () => ({
  lookupOrder: (...a: unknown[]) => lookupOrder(...a),
  getMyOrder: vi.fn(),
}));
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "rose", shopBasePath: "/rose", shop: { name: "Rose Shop" } }),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ customer: null, loading: false }) }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(tokenInUrl.value ? `token=${tokenInUrl.value}` : ""),
}));
vi.mock("@/components/StorefrontPageShell", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/CurrencySymbol", () => ({ default: () => null }));

afterEach(() => {
  tokenInUrl.value = "";
  cleanup();
  vi.clearAllMocks();
});

const NEW_TOKEN = "0123456789ABCDEF0123456789ABCDEF";
const LEGACY_TOKEN = "0123456789";

describe("track order page token shapes", () => {
  it.each([NEW_TOKEN, LEGACY_TOKEN])("sends a %s token from the link unchanged", async (token) => {
    lookupOrder.mockRejectedValue(new Error("No order found for that tracking code"));
    tokenInUrl.value = token;
    render(<TrackOrderPage />);
    await waitFor(() => expect(lookupOrder).toHaveBeenCalledWith(token));
  });

  it.each([NEW_TOKEN, LEGACY_TOKEN])("sends a typed %s token, trimmed, without length checks", async (token) => {
    lookupOrder.mockRejectedValue(new Error("No order found for that tracking code"));
    render(<TrackOrderPage />);
    fireEvent.change(screen.getByPlaceholderText("Tracking code"), { target: { value: `  ${token} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Track" }));
    await waitFor(() => expect(lookupOrder).toHaveBeenCalledWith(token));
  });
});
