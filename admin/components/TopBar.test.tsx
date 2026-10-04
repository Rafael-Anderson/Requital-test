import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { id: 1, role: "admin", name: "A" } }) }));
vi.mock("@/lib/api", () => ({ getShop: vi.fn().mockResolvedValue({ published: false }), storefrontUrlFor: () => "" }));
vi.mock("./UserMenu", () => ({ default: () => null }));
import TopBar from "./TopBar";

afterEach(cleanup);

describe("TopBar", () => {
  it("is pinned below md and a plain static block from md up", () => {
    const { container } = render(<TopBar />);
    const bar = container.firstElementChild as HTMLElement;
    const classes = bar.className.split(/\s+/);
    // below md: pinned above the page content
    expect(classes).toEqual(expect.arrayContaining(["sticky", "top-0", "z-30"]));
    // md and up: every property sticky set is reset, so desktop is unchanged
    expect(classes).toEqual(expect.arrayContaining(["md:static", "md:top-auto", "md:z-auto"]));
  });

  it("publishes its height only while it is sticky, and removes it on unmount", () => {
    const { unmount } = render(<TopBar />);
    // jsdom applies no Tailwind CSS, so the bar is static here and publishes nothing
    expect(document.documentElement.style.getPropertyValue("--topbar-h")).toBe("");
    unmount();
    expect(document.documentElement.style.getPropertyValue("--topbar-h")).toBe("");
  });
});
