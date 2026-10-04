import { describe, expect, it, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MobileNav, { MobileNavTrigger } from "./MobileNav";
import { MobileNavProvider, OPEN_SEARCH_EVENT } from "@/lib/mobile-nav";
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
vi.mock("@/lib/api", () => ({ getMenu: vi.fn(), listCollections: vi.fn() }));
import { getMenu, listCollections } from "@/lib/api";

// The hamburger lives in the header row (ThemeDrivenHeader) and the panel in <MobileNav>; they share state
// through the provider, so every drawer/fullscreen test renders both.
function renderNav(mode: "drawer" | "fullscreen") {
  return render(
    <MobileNavProvider>
      <MobileNavTrigger />
      <MobileNav mode={mode} />
    </MobileNavProvider>,
  );
}

vi.stubGlobal(
  "matchMedia",
  vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);

afterEach(() => {
  cleanup();
  vi.mocked(listCollections).mockReset();
});

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

  it("flags :root with data-bottom-nav while mounted so fixed bottom elements stack above it", () => {
    const { unmount } = render(<MobileNav mode="bottom-bar" />);
    expect(document.documentElement.hasAttribute("data-bottom-nav")).toBe(true);
    unmount();
    expect(document.documentElement.hasAttribute("data-bottom-nav")).toBe(false);
  });

  it("does not flag :root in drawer mode", () => {
    vi.mocked(getMenu).mockResolvedValue([]);
    renderNav("drawer");
    expect(document.documentElement.hasAttribute("data-bottom-nav")).toBe(false);
  });
});

describe("MobileNav — drawer/fullscreen", () => {
  it("fetches the menu and shows a hamburger trigger, closed by default", async () => {
    vi.mocked(getMenu).mockResolvedValue(MENU_ITEMS);
    renderNav("drawer");
    await waitFor(() => expect(getMenu).toHaveBeenCalledWith("test-shop", undefined));
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the panel on hamburger click and shows fetched menu items", async () => {
    const user = userEvent.setup();
    vi.mocked(getMenu).mockResolvedValue(MENU_ITEMS);
    renderNav("drawer");
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Roses")).toBeInTheDocument();
    expect(screen.getByText("Occasions")).toBeInTheDocument();
  });

  it("closes via the X button", async () => {
    const user = userEvent.setup();
    vi.mocked(getMenu).mockResolvedValue([]);
    renderNav("drawer");
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    vi.mocked(getMenu).mockResolvedValue([]);
    renderNav("drawer");
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
    renderNav("drawer");
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = await screen.findByRole("dialog");
    // Backdrop is the dialog's own previous sibling inside the portal root.
    await user.click(dialog.previousSibling as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clicking a link inside the panel closes it (onNavigate)", async () => {
    const user = userEvent.setup();
    vi.mocked(getMenu).mockResolvedValue(MENU_ITEMS);
    renderNav("drawer");
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByText("Roses"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("fullscreen mode also fetches the menu and opens/closes the same way", async () => {
    const user = userEvent.setup();
    vi.mocked(getMenu).mockResolvedValue([]);
    renderNav("fullscreen");
    await waitFor(() => expect(getMenu).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});


describe("MobileNav — keyboard, focus and scroll (N4)", () => {
  it("does not render its own hamburger (the header row owns it, so it can never cover the logo)", () => {
    vi.mocked(getMenu).mockResolvedValue([]);
    render(
      <MobileNavProvider>
        <MobileNav mode="drawer" />
      </MobileNavProvider>,
    );
    expect(screen.queryByRole("button", { name: "Open menu" })).not.toBeInTheDocument();
  });

  it("a closed panel is inert, so its links are out of the tab order", async () => {
    vi.mocked(getMenu).mockResolvedValue(MENU_ITEMS);
    renderNav("drawer");
    await waitFor(() => expect(getMenu).toHaveBeenCalled());
    const panel = document.querySelector('[aria-label="Menu"]') as HTMLElement;
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(panel.getAttribute("role")).toBeNull();
  });

  it("opening moves focus into the panel and un-inerts it; Escape closes and returns focus to the hamburger", async () => {
    const user = userEvent.setup();
    vi.mocked(getMenu).mockResolvedValue(MENU_ITEMS);
    renderNav("drawer");
    const trigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.hasAttribute("inert")).toBe(false);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("returns focus to the hamburger even when the click never focused it (Safari does not focus buttons on click)", async () => {
    vi.mocked(getMenu).mockResolvedValue([]);
    renderNav("drawer");
    const trigger = screen.getByRole("button", { name: "Open menu" });
    expect(document.activeElement).not.toBe(trigger);
    fireEvent.click(trigger); // a click that moves no focus
    await screen.findByRole("dialog");
    await waitFor(() => expect(document.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });

  it("Tab and Shift+Tab stay inside the open panel", async () => {
    const user = userEvent.setup();
    // Plain links only: jsdom does not make <summary> focusable, a jsdom gap rather than a product one.
    vi.mocked(getMenu).mockResolvedValue([
      MENU_ITEMS[0],
      { ...MENU_ITEMS[0], id: 3, label: "Tulips", collection: { id: 3, name: "Tulips", slug: "tulips" } },
    ]);
    renderNav("drawer");
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("locks page scroll while open and restores it on close", async () => {
    const user = userEvent.setup();
    vi.mocked(getMenu).mockResolvedValue([]);
    document.body.style.overflow = "";
    renderNav("drawer");
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("dialog");
    expect(document.body.style.overflow).toBe("hidden");
    await user.click(screen.getByRole("button", { name: "Close menu" }));
    expect(document.body.style.overflow).toBe("");
  });

  it("falls back to the top-level collections when no menu is configured (the panel used to be empty)", async () => {
    const user = userEvent.setup();
    vi.mocked(getMenu).mockResolvedValue([]);
    vi.mocked(listCollections).mockResolvedValue([
      { id: 1, name: "Roses", slug: "roses", parentCollectionId: null },
      { id: 2, name: "Sub", slug: "sub", parentCollectionId: 1 },
    ] as never);
    renderNav("drawer");
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("dialog");
    expect(await screen.findByText("Roses")).toBeInTheDocument();
    expect(screen.queryByText("Sub")).not.toBeInTheDocument();
  });

  it("the bottom-bar Search tab asks the header search to open (it used to do nothing)", async () => {
    const user = userEvent.setup();
    const seen = vi.fn();
    window.addEventListener(OPEN_SEARCH_EVENT, seen);
    render(<MobileNav mode="bottom-bar" />);
    await user.click(screen.getByRole("button", { name: /Search/ }));
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_SEARCH_EVENT, seen);
  });
});
