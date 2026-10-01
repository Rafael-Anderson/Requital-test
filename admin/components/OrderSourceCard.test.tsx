import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import OrderSourceCard from "./OrderSourceCard";

describe("OrderSourceCard", () => {
  it("unknown (null) says not recorded and never claims 'direct'", () => {
    render(<OrderSourceCard attribution={null} />);
    expect(screen.getByText(/Not recorded\./)).toBeInTheDocument();
    expect(screen.queryByText(/direct/i)).not.toBeInTheDocument();
  });

  it("shows last and first touch, landing page and the shopper's cookie choice", () => {
    render(
      <OrderSourceCard
        attribution={{
          consentMarketing: true,
          firstTouch: { source: "news", medium: "email", landingPath: "/products/rose" },
          lastTouch: { source: "google", medium: "cpc", campaign: "spring", referrer: "https://www.google.com/" },
        }}
      />,
    );
    expect(screen.getByText("google / cpc / spring")).toBeInTheDocument();
    expect(screen.getByText("news / email")).toBeInTheDocument();
    expect(screen.getByText("https://www.google.com/")).toBeInTheDocument();
    expect(screen.getByText("Accepted")).toBeInTheDocument();
  });

  it("declined and unknown consent are distinct", () => {
    const { rerender } = render(
      <OrderSourceCard attribution={{ consentMarketing: false, firstTouch: null, lastTouch: { source: "a" } }} />,
    );
    expect(screen.getByText("Declined")).toBeInTheDocument();
    rerender(<OrderSourceCard attribution={{ consentMarketing: null, firstTouch: null, lastTouch: { source: "a" } }} />);
    expect(screen.getByText("Not recorded")).toBeInTheDocument();
  });

  it("does not repeat first touch when it equals last touch", () => {
    render(
      <OrderSourceCard
        attribution={{ consentMarketing: null, firstTouch: { source: "a", medium: "b" }, lastTouch: { source: "a", medium: "b" } }}
      />,
    );
    expect(screen.queryByText("First touch")).not.toBeInTheDocument();
  });
});
