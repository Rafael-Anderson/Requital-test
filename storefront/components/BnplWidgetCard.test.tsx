import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import BnplWidgetCard from "./BnplWidgetCard";

afterEach(cleanup);

// Both provider widgets pull an external SDK via loadScriptOnce — stub it so
// the test never touches the network.
vi.mock("@/lib/load-script", () => ({
  loadScriptOnce: () => new Promise(() => {}),
}));

describe("BnplWidgetCard", () => {
  it("renders the card title and a row per provider that has a key", () => {
    const { container } = render(
      <BnplWidgetCard price={199} currency="AED" tabbyKey="pk_tabby" tamaraKey="pk_tamara" />,
    );
    expect(screen.getByText("Buy Now Pay Later!")).toBeInTheDocument();
    expect(container.querySelector("#tabby-promo")).toBeTruthy();
  });

  it("omits the Tabby row when only Tamara has a key", () => {
    const { container } = render(
      <BnplWidgetCard price={199} currency="AED" tabbyKey={null} tamaraKey="pk_tamara" />,
    );
    expect(screen.getByText("Buy Now Pay Later!")).toBeInTheDocument();
    expect(container.querySelector("#tabby-promo")).toBeNull();
  });
});
