import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import BnplWidgetCard from "./BnplWidgetCard";

afterEach(cleanup);

describe("BnplWidgetCard", () => {
  it("renders the card title and a row per available provider, with our own copy", () => {
    render(<BnplWidgetCard tabby tamara />);
    expect(screen.getByText("Buy Now Pay Later!")).toBeInTheDocument();
    expect(screen.getByText("Pay in 4 interest-free payments!")).toBeInTheDocument();
    expect(screen.getByText("Split your bill into 3 payments. Interest-free!")).toBeInTheDocument();
    expect(screen.getAllByText("Learn More")).toHaveLength(2);
  });

  it("omits the Tabby row when only Tamara is available", () => {
    render(<BnplWidgetCard tabby={false} tamara />);
    expect(screen.queryByText("Pay in 4 interest-free payments!")).toBeNull();
    expect(screen.getByText("Split your bill into 3 payments. Interest-free!")).toBeInTheDocument();
  });

  it("renders nothing when no provider is available", () => {
    const { container } = render(<BnplWidgetCard tabby={false} tamara={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
