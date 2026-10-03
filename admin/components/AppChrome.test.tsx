import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("@/components/TopBar", () => ({ default: () => null }));
vi.mock("@/components/CountryBanner", () => ({ default: () => null }));
vi.mock("@/components/EmailVerificationBanner", () => ({ default: () => null }));
vi.mock("@/components/ImpersonationBanner", () => ({ default: () => null }));
vi.mock("@/components/NewOrderBanner", () => ({ default: () => null }));
vi.mock("@/components/CommandPalette", () => ({ default: () => null }));
import AppChrome from "./AppChrome";

afterEach(cleanup);

describe("AppChrome", () => {
  it("uses a 16px gutter on phones and keeps 48px from md up", () => {
    const { container } = render(<AppChrome><p>x</p></AppChrome>);
    const main = container.querySelector("main")!;
    expect(main.className).toMatch(/\bpx-4\b/);
    expect(main.className).toMatch(/\bmd:px-12\b/);
    expect(main.className).not.toMatch(/(^|\s)px-12\b/);
  });
});
