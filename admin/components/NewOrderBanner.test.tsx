import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import NewOrderBanner from "./NewOrderBanner";
import { useAuth } from "@/lib/auth-context";
import { listOrders } from "@/lib/api";
import type { AuthUser } from "@/lib/types";

vi.mock("@/lib/auth-context", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  listOrders: vi.fn(),
}));

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
});
