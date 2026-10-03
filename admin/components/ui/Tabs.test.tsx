import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Tabs from "./Tabs";

let pathname = "/a";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

describe("Tabs", () => {
  it("renders each tab with its href", () => {
    pathname = "/a";
    render(
      <Tabs
        tabs={[
          { href: "/a", label: "A" },
          { href: "/b", label: "B" },
        ]}
      />,
    );
    expect(screen.getByText("A").closest("a")).toHaveAttribute("href", "/a");
    expect(screen.getByText("B").closest("a")).toHaveAttribute("href", "/b");
  });

  it("marks only the exact-matching tab active by default", () => {
    pathname = "/a";
    render(
      <Tabs
        tabs={[
          { href: "/a", label: "A" },
          { href: "/a/child", label: "A child" },
        ]}
      />,
    );
    expect(screen.getByText("A").closest("a")).toHaveClass("text-accent-text");
    expect(screen.getByText("A child").closest("a")).not.toHaveClass("text-accent-text");
  });

  it("marks an exact:false tab active for any sub-route", () => {
    pathname = "/a/child/grandchild";
    render(<Tabs tabs={[{ href: "/a", label: "A", exact: false }]} />);
    expect(screen.getByText("A").closest("a")).toHaveClass("text-accent-text");
  });
});

describe("Tabs a11y and scroll hook", () => {
  it("marks the active tab with aria-current and only that tab", () => {
    pathname = "/b";
    render(
      <Tabs
        tabs={[
          { href: "/a", label: "A" },
          { href: "/b", label: "B" },
        ]}
      />,
    );
    expect(screen.getByText("B").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("A").closest("a")).not.toHaveAttribute("aria-current");
  });

  it("is a scroll-fade container so a clipped tab row shows it can scroll", () => {
    pathname = "/a";
    const { container } = render(<Tabs tabs={[{ href: "/a", label: "A" }]} />);
    expect(container.firstElementChild).toHaveAttribute("data-scroll-fade");
  });
});
