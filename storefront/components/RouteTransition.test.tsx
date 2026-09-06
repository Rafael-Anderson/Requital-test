import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import RouteTransition from "./RouteTransition";

let themeConfig: unknown = null;
let pathname = "/shop/a";
vi.mock("@/lib/shop-context", () => ({ useShop: () => ({ themeConfig }) }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

afterEach(() => {
  cleanup();
  themeConfig = null;
  pathname = "/shop/a";
});

const cfg = (pageTransition: unknown) => ({ globalSettings: { animations: { pageTransition } } });

describe("RouteTransition (§8.13.C item 17)", () => {
  it("no-op: absent themeConfig ⇒ children render with no wrapper", () => {
    const { container } = render(
      <RouteTransition><span data-testid="c">hi</span></RouteTransition>,
    );
    expect(container.querySelector(".theme-route-transition")).toBeNull();
    expect(container.firstElementChild?.getAttribute("data-testid")).toBe("c");
  });

  it("no-op: pageTransition false ⇒ no wrapper", () => {
    themeConfig = cfg(false);
    const { container } = render(
      <RouteTransition><span data-testid="c">hi</span></RouteTransition>,
    );
    expect(container.querySelector(".theme-route-transition")).toBeNull();
  });

  it("pageTransition true ⇒ a .theme-route-transition wrapper, keyed on the pathname", () => {
    themeConfig = cfg(true);
    const { container, rerender } = render(
      <RouteTransition><span>page a</span></RouteTransition>,
    );
    const wrap = container.querySelector(".theme-route-transition") as HTMLElement;
    expect(wrap).not.toBeNull();
    expect(wrap.textContent).toBe("page a");

    // a pathname change remounts the wrapper (new React key) so the keyframe replays
    pathname = "/shop/b";
    rerender(<RouteTransition><span>page b</span></RouteTransition>);
    const wrap2 = container.querySelector(".theme-route-transition") as HTMLElement;
    expect(wrap2.textContent).toBe("page b");
  });
});
