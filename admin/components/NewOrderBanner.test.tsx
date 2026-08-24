import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import NewOrderBanner from "./NewOrderBanner";
import { useAuth } from "@/lib/auth-context";
import { listOrders } from "@/lib/api";
import { playOrderSound } from "@/lib/notification-sound";
import type { AuthUser, Order } from "@/lib/types";

vi.mock("@/lib/auth-context", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  listOrders: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// diffNewOrderIds is kept real (it's the pure dedup logic under test
// elsewhere in notification-sound.test.ts) — only playOrderSound is
// mocked, since it touches a real Audio element jsdom doesn't implement.
vi.mock("@/lib/notification-sound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notification-sound")>();
  return { ...actual, playOrderSound: vi.fn() };
});

function mockOrder(id: number, customerName = "Test Customer"): Order {
  return { id, customerName } as unknown as Order;
}

function mockUser(role: AuthUser["role"]): AuthUser {
  return {
    id: 1,
    shopId: 1,
    outletId: null,
    name: "Test",
    email: "test@test.com",
    role,
    emailVerified: true,
    createdAt: new Date().toISOString(),
  };
}

describe("NewOrderBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing before the user loads", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null } as ReturnType<typeof useAuth>);
    const { container } = render(<NewOrderBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a viewer role even with pending orders", async () => {
    vi.mocked(useAuth).mockReturnValue({ user: mockUser("viewer") } as ReturnType<typeof useAuth>);
    vi.mocked(listOrders).mockResolvedValue({ data: [], page: 1, pageSize: 1, total: 3 });
    const { container } = render(<NewOrderBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container).toBeEmptyDOMElement();
    expect(listOrders).not.toHaveBeenCalled();
  });

  it("renders nothing when there are no pending orders", async () => {
    vi.mocked(useAuth).mockReturnValue({ user: mockUser("admin") } as ReturnType<typeof useAuth>);
    vi.mocked(listOrders).mockResolvedValue({ data: [], page: 1, pageSize: 1, total: 0 });
    const { container } = render(<NewOrderBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listOrders).toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the pending count and a link to Orders for an admin", async () => {
    vi.mocked(useAuth).mockReturnValue({ user: mockUser("admin") } as ReturnType<typeof useAuth>);
    vi.mocked(listOrders).mockResolvedValue({ data: [], page: 1, pageSize: 1, total: 2 });
    render(<NewOrderBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(/2 new orders waiting to be accepted/)).toBeInTheDocument();
    expect(screen.getByText("View orders")).toBeInTheDocument();
  });

  it("uses singular phrasing for exactly one pending order", async () => {
    vi.mocked(useAuth).mockReturnValue({ user: mockUser("branch") } as ReturnType<typeof useAuth>);
    vi.mocked(listOrders).mockResolvedValue({ data: [], page: 1, pageSize: 1, total: 1 });
    render(<NewOrderBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(/1 new order waiting to be accepted/)).toBeInTheDocument();
  });

  it("polls again after the interval elapses", async () => {
    vi.mocked(useAuth).mockReturnValue({ user: mockUser("order_manager") } as ReturnType<typeof useAuth>);
    vi.mocked(listOrders).mockResolvedValue({ data: [], page: 1, pageSize: 1, total: 1 });
    render(<NewOrderBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listOrders).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(listOrders).toHaveBeenCalledTimes(2);
  });

  it("does not play a sound or show a persistent notification for orders that already existed on the first poll", async () => {
    vi.mocked(useAuth).mockReturnValue({ user: mockUser("admin") } as ReturnType<typeof useAuth>);
    vi.mocked(listOrders).mockResolvedValue({
      data: [mockOrder(1)],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    render(<NewOrderBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(playOrderSound).not.toHaveBeenCalled();
    expect(screen.queryByText(/new order received/i)).not.toBeInTheDocument();
  });

  it("plays a sound and shows a persistent notification for an order that arrives after the first poll", async () => {
    vi.mocked(useAuth).mockReturnValue({ user: mockUser("admin") } as ReturnType<typeof useAuth>);
    vi.mocked(listOrders)
      .mockResolvedValueOnce({ data: [mockOrder(1)], page: 1, pageSize: 50, total: 1 })
      .mockResolvedValue({
        data: [mockOrder(1), mockOrder(2, "New Customer")],
        page: 1,
        pageSize: 50,
        total: 2,
      });
    render(<NewOrderBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // seeds order #1, no sound
    });
    expect(playOrderSound).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000); // order #2 arrives
    });
    expect(playOrderSound).toHaveBeenCalledTimes(1);
    expect(screen.getByText("New order received")).toBeInTheDocument();
    expect(screen.getByText("Order #2")).toBeInTheDocument();
    expect(screen.getByText("New Customer")).toBeInTheDocument();
    expect(screen.queryByText("Order #1")).not.toBeInTheDocument(); // #1 was pre-existing, never flagged
  });

  it("dismissing a new-order notification removes only that one", async () => {
    vi.mocked(useAuth).mockReturnValue({ user: mockUser("admin") } as ReturnType<typeof useAuth>);
    vi.mocked(listOrders)
      .mockResolvedValueOnce({ data: [], page: 1, pageSize: 50, total: 0 })
      .mockResolvedValue({
        data: [mockOrder(1), mockOrder(2)],
        page: 1,
        pageSize: 50,
        total: 2,
      });
    render(<NewOrderBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(screen.getByText("2 new orders received")).toBeInTheDocument();

    const dismissButtons = screen.getAllByLabelText("Dismiss");
    act(() => {
      dismissButtons[0].click();
    });

    expect(screen.getByText("New order received")).toBeInTheDocument(); // singular now, one left
  });
});
