import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import HomePage from "./page";
import { getShop } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  getShop: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { role: "admin" } }),
}));

function renderPage() {
  return render(<HomePage />);
}

describe("HomePage — Reports tile mode gating", () => {
  it("simple mode: greys out the Reports tile (not a link)", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "simple" } as never);
    renderPage();

    await waitFor(() => expect(screen.getByText("Reports").closest("a")).toBeNull());
    expect(screen.getByText("Reports").closest("[aria-disabled='true']")).toBeInTheDocument();
  });

  it("advanced mode: Reports tile is a normal link", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "advanced" } as never);
    renderPage();

    await waitFor(() => expect(screen.getByText("Reports").closest("a")).toHaveAttribute("href", "/reports"));
  });
});

describe("HomePage — Theme tile dynamic-theme-builder badge", () => {
  it("shows a Beta badge on the Theme tile when dynamicThemeBuilderEnabled is on", async () => {
    vi.mocked(getShop).mockResolvedValue({
      productEditorMode: "advanced",
      dynamicThemeBuilderEnabled: true,
    } as never);
    renderPage();

    const themeTile = await screen.findByText("Theme");
    await waitFor(() =>
      expect(themeTile.closest("a")?.querySelector("[title='Dynamic theme builder enabled']")).toBeInTheDocument(),
    );
  });

  it("shows no badge when dynamicThemeBuilderEnabled is off (the default)", async () => {
    vi.mocked(getShop).mockResolvedValue({
      productEditorMode: "advanced",
      dynamicThemeBuilderEnabled: false,
    } as never);
    renderPage();

    const themeTile = await screen.findByText("Theme");
    await waitFor(() => expect(themeTile.closest("a")).toHaveAttribute("href", "/theme"));
    expect(themeTile.closest("a")?.querySelector("[title='Dynamic theme builder enabled']")).not.toBeInTheDocument();
  });
});
