import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BnplWidgetCard from "./BnplWidgetCard";

afterEach(cleanup);

// Real script-loading is TabbyPromoWidget's/TamaraWidget's own concern
// (see their own test files) — this file only tests BnplWidgetCard's
// composition/gating logic, so each is stubbed to a simple marker plus an
// "onLoadError" trigger button.
vi.mock("./TabbyPromoWidget", () => ({
  default: ({ onLoadError }: { onLoadError: () => void }) => (
    <div>
      tabby-widget
      <button onClick={onLoadError}>fail tabby</button>
    </div>
  ),
}));
vi.mock("./TamaraWidget", () => ({
  default: ({ onLoadError }: { onLoadError: () => void }) => (
    <div>
      tamara-widget
      <button onClick={onLoadError}>fail tamara</button>
    </div>
  ),
}));

const baseProps = {
  tabbyPublicKey: "pk_tabby",
  tabbyMerchantCode: "mc_tabby",
  tamaraPublicKey: "pk_tamara",
  price: "100.00",
  currency: "AED",
};

describe("BnplWidgetCard", () => {
  it("renders the card title and both providers' widgets when both are configured", () => {
    render(<BnplWidgetCard {...baseProps} />);
    expect(screen.getByText("Buy Now Pay Later!")).toBeInTheDocument();
    expect(screen.getByText("tabby-widget")).toBeInTheDocument();
    expect(screen.getByText("tamara-widget")).toBeInTheDocument();
  });

  it("only renders the Tamara widget when only Tamara is configured", () => {
    render(<BnplWidgetCard {...baseProps} tabbyPublicKey={null} />);
    expect(screen.queryByText("tabby-widget")).not.toBeInTheDocument();
    expect(screen.getByText("tamara-widget")).toBeInTheDocument();
  });

  it("only renders the Tabby widget when only Tabby is configured", () => {
    render(<BnplWidgetCard {...baseProps} tamaraPublicKey={null} />);
    expect(screen.getByText("tabby-widget")).toBeInTheDocument();
    expect(screen.queryByText("tamara-widget")).not.toBeInTheDocument();
  });

  it("renders nothing when neither provider is configured", () => {
    const { container } = render(<BnplWidgetCard {...baseProps} tabbyPublicKey={null} tamaraPublicKey={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hides just the Tabby row (keeping Tamara) when Tabby's widget fails to load", async () => {
    const user = userEvent.setup();
    render(<BnplWidgetCard {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "fail tabby" }));

    expect(screen.queryByText("tabby-widget")).not.toBeInTheDocument();
    expect(screen.getByText("tamara-widget")).toBeInTheDocument();
    expect(screen.getByText("Buy Now Pay Later!")).toBeInTheDocument();
  });

  it("hides the whole card when every configured provider's widget fails to load", async () => {
    const user = userEvent.setup();
    const { container } = render(<BnplWidgetCard {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "fail tabby" }));
    await user.click(screen.getByRole("button", { name: "fail tamara" }));

    expect(container).toBeEmptyDOMElement();
  });
});
