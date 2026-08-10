import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AttributesSection from "./AttributesSection";

// Spot-check for the icon-only row-action tooltip pattern applied across
// the app (Table.tsx's Edit/Delete convention, and every "Remove X" icon
// button like this one) — confirms the wrapping Tooltip renders with
// explanatory text, not just the bare aria-label a screen reader alone
// would get.
describe("AttributesSection remove-row tooltip", () => {
  it("wraps the remove button in a Tooltip explaining the action", () => {
    render(
      <AttributesSection
        attributes={[{ name: "Material", value: "Cotton", order: 0 }]}
        onChange={() => {}}
        enabled
        defaultOpen
        onEnable={() => {}}
        onDisable={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Remove attribute" })).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Remove this attribute");
  });

  it("renders no remove row (and no tooltip) when the attribute list is empty", () => {
    render(
      <AttributesSection
        attributes={[]}
        onChange={() => {}}
        enabled
        defaultOpen
        onEnable={() => {}}
        onDisable={() => {}}
      />,
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
