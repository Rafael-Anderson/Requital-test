import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderReturnsSection from "./OrderReturnsSection";
import { ToastProvider } from "@/components/ui/Toast";
import type { Order } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  getOrderReturns: vi.fn(),
  createOrderReturn: vi.fn(),
}));
import { getOrderReturns } from "@/lib/api";

function deliveredOrder(): Order {
  return {
    id: 7,
    status: "delivered",
    orderitem: [
      { id: 1, productName: "Rose Bouquet", variantLabel: null, quantity: 2, priceAtPurchase: "50" },
    ],
  } as unknown as Order;
}

async function renderInitiating() {
  vi.mocked(getOrderReturns).mockResolvedValue([]);
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <OrderReturnsSection order={deliveredOrder()} />
    </ToastProvider>,
  );
  await screen.findByText("No returns yet.");
  await user.click(screen.getByRole("button", { name: "Process return" }));
  return user;
}

describe("OrderReturnsSection — return reason picker", () => {
  it("renders the reason picker as a Combobox, not a native select", async () => {
    await renderInitiating();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(document.querySelector("select")).not.toBeInTheDocument();
  });

  it("opens and selects a reason", async () => {
    const user = await renderInitiating();
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Wrong item" }));
    expect(screen.getByRole("combobox")).toHaveTextContent("Wrong item");
  });
});
