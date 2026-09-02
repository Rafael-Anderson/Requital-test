import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import TrustBarSection from "./TrustBarSection";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

afterEach(cleanup);

const B = (type: string, settings: Record<string, unknown>, order = 0): ThemeBlock => ({
  id: `${type}-${order}`,
  type,
  visible: true,
  order,
  settings,
});

function renderTrustBar(blocks: ThemeBlock[]) {
  return render(<TrustBarSection sectionId="s" settings={{} as SectionSettings} blocks={blocks} />);
}

describe("TrustBarSection", () => {
  it("renders nothing when there is no visible content", () => {
    const { container } = renderTrustBar([]);
    expect(container.firstChild).toBeNull();
  });

  it("renders trust items with their text", () => {
    const { getByText } = renderTrustBar([
      B("trust_item", { text: "Same-day delivery", icon: "truck" }, 0),
      B("trust_item", { text: "Fresh guarantee", icon: "shield" }, 1),
    ]);
    expect(getByText("Same-day delivery")).toBeInTheDocument();
    expect(getByText("Fresh guarantee")).toBeInTheDocument();
  });

  it("renders a rating badge (number + 5 stars) and links it when a url is set", () => {
    const { getByText, container } = renderTrustBar([
      B("rating_badge", { rating: 4.7, label: "1,200 reviews", url: "https://reviews.example" }, 0),
    ]);
    expect(getByText("4.7")).toBeInTheDocument();
    expect(getByText("· 1,200 reviews")).toBeInTheDocument();
    const link = container.querySelector("a[href='https://reviews.example']");
    expect(link).not.toBeNull();
    expect(link!.querySelectorAll("svg").length).toBe(5);
  });

  it("skips a hidden block", () => {
    const { queryByText } = renderTrustBar([
      { ...B("trust_item", { text: "Hidden" }, 0), visible: false },
      B("trust_item", { text: "Shown" }, 1),
    ]);
    expect(queryByText("Hidden")).toBeNull();
    expect(queryByText("Shown")).not.toBeNull();
  });
});
