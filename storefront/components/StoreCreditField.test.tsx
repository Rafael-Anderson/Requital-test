import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StoreCreditField from "./StoreCreditField";

afterEach(cleanup);

const auth = vi.hoisted(() => ({ customer: { id: 1 } as { id: number } | null }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ customer: auth.customer }) }));
vi.mock("@/lib/api", () => ({ getMyStoreCredit: vi.fn() }));
import { getMyStoreCredit } from "@/lib/api";

const credit = (balances: { currency: string; balance: string; balanceMinor: number }[]) =>
  vi.mocked(getMyStoreCredit).mockResolvedValue({ balances, entries: [] });

describe("StoreCreditField", () => {
  it("shows nothing to a guest and never asks the server", () => {
    auth.customer = null;
    const { container } = render(<StoreCreditField shopSlug="s" currency="AED" checked={false} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(getMyStoreCredit).not.toHaveBeenCalled();
  });

  it("shows a balance in the shop currency and reports a plain yes/no", async () => {
    auth.customer = { id: 1 };
    credit([{ currency: "AED", balance: "20.00", balanceMinor: 2000 }]);
    const onChange = vi.fn();
    render(<StoreCreditField shopSlug="s" currency="AED" checked={false} onChange={onChange} />);
    const box = await screen.findByRole("checkbox");
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("ignores credit held in another currency (it cannot be spent here)", async () => {
    auth.customer = { id: 1 };
    credit([{ currency: "KWD", balance: "5.000", balanceMinor: 5000 }]);
    const { container } = render(<StoreCreditField shopSlug="s" currency="AED" checked={false} onChange={vi.fn()} />);
    await waitFor(() => expect(getMyStoreCredit).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the balance cannot be loaded", async () => {
    auth.customer = { id: 1 };
    vi.mocked(getMyStoreCredit).mockRejectedValue(new Error("boom"));
    const { container } = render(<StoreCreditField shopSlug="s" currency="AED" checked={false} onChange={vi.fn()} />);
    await waitFor(() => expect(getMyStoreCredit).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
