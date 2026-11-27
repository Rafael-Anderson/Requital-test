import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import OrderSourceTag from "./OrderSourceTag";

afterEach(cleanup);

describe("OrderSourceTag", () => {
  it("shows nothing for a Website order", () => {
    const { container } = render(<OrderSourceTag order={{ source: "website", channel: "storefront" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["custom", "Custom"],
    ["talabat", "Talabat"],
    ["deliveroo", "Deliveroo"],
  ])("tags a %s order with its short text and full name", (source, text) => {
    render(<OrderSourceTag order={{ source, channel: null }} />);
    const tag = screen.getByTestId("order-source-tag");
    expect(tag).toHaveTextContent(text);
    expect(tag).toHaveAttribute("data-source", source);
    expect(tag.className).toContain("rounded-full");
  });

  it("keeps the marketplace badge for a marketplace with no registry entry", () => {
    render(<OrderSourceTag order={{ source: "website", channel: "stub_marketplace" }} />);
    expect(screen.queryByTestId("order-source-tag")).toBeNull();
    expect(screen.getByText("Test marketplace")).toBeInTheDocument();
  });
});
