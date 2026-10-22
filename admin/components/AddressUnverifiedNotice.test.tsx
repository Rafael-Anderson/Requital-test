import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AddressUnverifiedNotice, { ADDRESS_UNVERIFIED_MESSAGE } from "./AddressUnverifiedNotice";

describe("AddressUnverifiedNotice", () => {
  it("says the same thing as the packing slip, with no em dash", () => {
    render(<AddressUnverifiedNotice />);
    expect(screen.getByRole("note")).toHaveTextContent(
      "Address not verified on a map, please confirm with the customer",
    );
    expect(ADDRESS_UNVERIFIED_MESSAGE).not.toContain("—");
  });
  it("compact form keeps the full sentence as its tooltip", () => {
    render(<AddressUnverifiedNotice compact />);
    expect(screen.getByText("Address not verified")).toHaveAttribute("title", ADDRESS_UNVERIFIED_MESSAGE);
  });
});
