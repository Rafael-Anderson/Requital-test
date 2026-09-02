import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import AnnouncementBar from "./AnnouncementBar";

let shopValue: unknown;
let themeConfigValue: unknown;

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shop: shopValue, shopSlug: "roses", themeConfig: themeConfigValue }),
}));

function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

beforeEach(() => {
  stubMatchMedia();
  localStorage.clear();
  shopValue = undefined;
  themeConfigValue = undefined;
});
afterEach(cleanup);

function withAnnouncementBar(announcementBar: unknown) {
  themeConfigValue = { header: { settings: { announcementBar } } };
}

describe("AnnouncementBar — legacy fallback (unchanged)", () => {
  it("renders nothing when neither the themed config nor the legacy toggle is set", () => {
    const { container } = render(<AnnouncementBar />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the legacy bg-accent bar from shop.notificationText when announcementBarEnabled", () => {
    shopValue = { announcementBarEnabled: true, notificationText: JSON.stringify(["Legacy line"]) };
    const { container } = render(<AnnouncementBar />);
    expect(container.textContent).toContain("Legacy line");
    expect(container.querySelector(".bg-accent")).not.toBeNull();
  });

  it("legacy bar is not shown once a themed config with enabled:false exists (still falls through)", () => {
    shopValue = { announcementBarEnabled: true, notificationText: JSON.stringify(["Legacy line"]) };
    withAnnouncementBar({ enabled: false, messages: ["ignored"] });
    const { container } = render(<AnnouncementBar />);
    // enabled:false ⇒ normalizeConfig returns null ⇒ legacy path still renders
    expect(container.textContent).toContain("Legacy line");
  });
});

describe("AnnouncementBar — themed persistent bar (Phase 5)", () => {
  it("renders the first message and, when dismissible, an X that persists to localStorage", () => {
    withAnnouncementBar({ enabled: true, messages: ["First msg", "Second msg"], dismissible: true });
    const { container } = render(<AnnouncementBar />);
    expect(container.textContent).toContain("First msg");

    fireEvent.click(screen.getByRole("button", { name: /dismiss announcement/i }));
    expect(container.firstChild).toBeNull();
    // key is per shop + per message set
    const key = Object.keys(localStorage).find((k) => k.startsWith("requital_storefront_announcement_dismissed:roses:"));
    expect(key && localStorage.getItem(key)).toBe("1");
  });

  it("stays hidden on next mount once dismissed for that message set", () => {
    const cfg = { enabled: true, messages: ["Sticky msg"], dismissible: true };
    withAnnouncementBar(cfg);
    const first = render(<AnnouncementBar />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss announcement/i }));
    first.unmount();

    const { container } = render(<AnnouncementBar />);
    expect(container.firstChild).toBeNull();
  });

  it("no X button when dismissible is not set", () => {
    withAnnouncementBar({ enabled: true, messages: ["No dismiss"] });
    render(<AnnouncementBar />);
    expect(screen.queryByRole("button", { name: /dismiss announcement/i })).toBeNull();
  });

  it("uses custom background/text colors when provided (no bg-accent fallback)", () => {
    withAnnouncementBar({ enabled: true, messages: ["Branded"], background: "#101010", textColor: "#eeeeee" });
    const { container } = render(<AnnouncementBar />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).not.toContain("bg-accent");
    expect(bar.style.background).toBe("rgb(16, 16, 16)");
  });
});
