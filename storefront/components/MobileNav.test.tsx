import { describe, expect, it, vi, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MobileNav from "./MobileNav";
import type { MenuItem } from "@/lib/types";

const MENU_ITEMS: MenuItem[] = [
  { id: 1, label: "Roses", type: "LINK", style: null, collectionId: 1, collection: { id: 1, name: "Roses", slug: "roses" }, collections: [], columns: [] },
  {
    id: 2,
    label: "Occasions",
    type: "DROPDOWN",
    style: null,
    collectionId: null,
    collection: null,
    collections: [{ collectionId: 2, sortOrder: 0, collection: { id: 2, name: "Birthdays", slug: "birthdays" } }],
    columns: [],
  },
];

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "test-shop", shopBasePath: "", previewToken: undefined }),
}));
vi.mock("@/lib/cart", () => ({ useCart: () => ({ count: 0 }) }));
vi.mock("@/lib/cart-drawer", () => ({ useCartDrawer: () => ({ openDrawer: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ customer: null }) }));
vi.mock("@/lib/api", () => ({ getMenu: vi.fn() }));
import { getMenu } from "@/lib/api";

vi.stubGlobal(
  "matchMedia",
  vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);

afterEach(cleanup);

describe("MobileNav — bottom-bar", () => {
  it("renders 5 fixed destinations and never fetches the menu", () => {
    render(<MobileNav mode="bottom-bar" />);
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Shop")).toBeInTheDocument();
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Cart")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(getMenu).not.toHaveBeenCalled();
  });
});

describe("MobileNav — drawer/fullscreen", () => {
  it("fetches the menu and shows a hamburger trigger, closed by default", async () => {
    vi.mocked(getMenu).mockResolvedValue(MENU_ITEMS);
    render(<MobileNav mode="drawer" />);
    await waitFor(() => expect(getMenu).toHaveBeenCalledWith("test-shop", undefined));
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the panel on hamburger click and shows fetched menu items", async () => {
    const user = userEvent.setup();
    vi.mocked(getMenu).mockResolvedValue(MENU_ITEMS);
    render(<MobileNav mode="drawer" />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Roses")).toBeInTheDocument();
    expect(screen.getByText("Occasions")).toBeInTheDocument();
  });

  it("closes via the X button", async () => {
    const user = userEvent.setup();
    vi.mocked(getMenu).mockResolvedValue([]);
    render(<MobileNav mode="drawer" />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    vi.mocked(getMenu).mockResolvedValue([]);
    render(<MobileNav mode="drawer" />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("dialog");
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on backdrop click", async () => {
    const user = userEvent.setup();
    vi.mocked(getMenu).mockResolvedValue([]);
    render(<MobileNav mode="drawer" />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = await screen.findByRole("dialog");
    // Backdrop is the dialog's own previous sibling inside the portal root.
    await user.click(dialog.previousSibling as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clicking a link inside the panel closes it (onNavigate)", async () => {
    const user = userEvent.setup();
    vi.mocked(getMenu).mockResolvedValue(MENU_ITEMS);
    render(<MobileNav mode="drawer" />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByText("Roses"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("fullscreen mode also fetches the menu and opens/closes the same way", async () => {
    const user = userEvent.setup();
    vi.mocked(getMenu).mockResolvedValue([]);
    render(<MobileNav mode="fullscreen" />);
    await waitFor(() => expect(getMenu).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
