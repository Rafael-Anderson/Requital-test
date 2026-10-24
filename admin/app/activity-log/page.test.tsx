import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({
  listAuditLog: vi.fn(),
  listAuditLogActors: vi.fn(),
}));
vi.mock("@/lib/api", () => api);
vi.mock("@/lib/useShopCurrency", () => ({ useShopCurrency: () => "AED" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/activity-log",
}));

import ActivityLogPage from "./page";

describe("activity log actor filter", () => {
  beforeEach(() => {
    api.listAuditLog.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25 });
    api.listAuditLogActors.mockResolvedValue([
      { id: 4, name: "Layla" },
      { id: null, name: "system (payment gateway)" },
    ]);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lists actors with no user row and filters them by label", async () => {
    render(<ActivityLogPage />);
    const option = await screen.findByRole("option", { name: "system (payment gateway)" });
    const select = option.parentElement as HTMLSelectElement;
    await userEvent.selectOptions(select, option);
    await waitFor(() =>
      expect(api.listAuditLog).toHaveBeenLastCalledWith(
        expect.objectContaining({ actorLabel: "system (payment gateway)", actorUserId: undefined }),
      ),
    );
  });

  it("still filters a staff member by id", async () => {
    render(<ActivityLogPage />);
    const option = await screen.findByRole("option", { name: "Layla" });
    await userEvent.selectOptions(option.parentElement as HTMLSelectElement, option);
    await waitFor(() =>
      expect(api.listAuditLog).toHaveBeenLastCalledWith(expect.objectContaining({ actorUserId: 4, actorLabel: undefined })),
    );
  });
});
