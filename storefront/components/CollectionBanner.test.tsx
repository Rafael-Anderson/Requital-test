import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
import CollectionBanner from "./CollectionBanner";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const base = { name: "Roses", description: "Fresh", shopBasePath: "/shop" };

describe("CollectionBanner", () => {
  it("renders no banner area at all without an image, only a plain title block", () => {
    render(<CollectionBanner {...base} bannerImage={undefined} />);
    expect(screen.queryByTestId("collection-banner")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByTestId("collection-title-block")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Roses" })).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByTestId("collection-title-block").innerHTML).not.toContain("E6F5F3");
  });

  it("applies title alignment and spacing to the plain block", () => {
    render(
      <CollectionBanner {...base} bannerImage={null} settings={{ titleAlign: "center", titleSpacing: 48 }} />,
    );
    const block = screen.getByTestId("collection-title-block");
    expect(block.style.paddingBlock).toBe("48px");
    expect((block.firstElementChild as HTMLElement).style.textAlign).toBe("center");
  });

  it("with an image keeps today's 220px banner on every viewport", () => {
    render(<CollectionBanner {...base} bannerImage="https://cdn.test/a.jpg" />);
    const banner = screen.getByTestId("collection-banner");
    expect(banner.style.getPropertyValue("--banner-h")).toBe("220px");
    expect(banner.style.getPropertyValue("--banner-h-md")).toBe("220px");
    expect(banner.querySelector("img")?.className).toContain("object-cover");
  });

  it("uses the merchant's desktop and mobile heights, and ignores invalid ones", () => {
    const { unmount } = render(
      <CollectionBanner
        {...base}
        bannerImage="https://cdn.test/a.jpg"
        settings={{ bannerHeight: 500, bannerHeightMobile: 260 }}
      />,
    );
    let banner = screen.getByTestId("collection-banner");
    expect(banner.style.getPropertyValue("--banner-h-md")).toBe("500px");
    expect(banner.style.getPropertyValue("--banner-h")).toBe("260px");
    unmount();
    render(
      <CollectionBanner {...base} bannerImage="https://cdn.test/a.jpg" settings={{ bannerHeight: 5000 }} />,
    );
    banner = screen.getByTestId("collection-banner");
    expect(banner.style.getPropertyValue("--banner-h-md")).toBe("220px");
  });
});
