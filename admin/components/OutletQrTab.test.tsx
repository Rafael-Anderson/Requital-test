import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import OutletQrTab from "./OutletQrTab";
import type { Outlet, Shop } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, getShop: vi.fn() };
});
import { getShop } from "@/lib/api";

function fakeShop(overrides: Partial<Shop> = {}): Shop {
  return { subdomain: "rose-shop", published: true, ...overrides } as unknown as Shop;
}

function fakeOutlet(): Outlet {
  return { id: 1, name: "Main Branch" } as unknown as Outlet;
}

describe("OutletQrTab", () => {
  it("renders a QR code encoding the shop's storefront URL", async () => {
    vi.mocked(getShop).mockResolvedValue(fakeShop());
    render(<OutletQrTab outlet={fakeOutlet()} />);

    await waitFor(() => expect(screen.getByText(/rose-shop/)).toBeInTheDocument());
    expect(document.querySelector("canvas")).toBeInTheDocument();
  });

  it("warns when the shop isn't published yet", async () => {
    vi.mocked(getShop).mockResolvedValue(fakeShop({ published: false }));
    render(<OutletQrTab outlet={fakeOutlet()} />);

    await waitFor(() =>
      expect(screen.getByText(/isn't published yet/)).toBeInTheDocument(),
    );
  });

  it("does not warn when the shop is published", async () => {
    vi.mocked(getShop).mockResolvedValue(fakeShop({ published: true }));
    render(<OutletQrTab outlet={fakeOutlet()} />);

    await waitFor(() => expect(document.querySelector("canvas")).toBeInTheDocument());
    expect(screen.queryByText(/isn't published yet/)).not.toBeInTheDocument();
  });
});
