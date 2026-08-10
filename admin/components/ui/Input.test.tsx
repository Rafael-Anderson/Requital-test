import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Input from "./Input";

// Spot-check for the settings-field tooltip pattern: an optional Info-icon
// tooltip next to the label for a field whose meaning isn't obvious from
// the label text alone.
describe("Input tooltip", () => {
  it("renders no info icon or tooltip when the tooltip prop is omitted", () => {
    render(<Input label="Business Name" value="" onChange={() => {}} />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renders an info icon with a Tooltip next to the label when tooltip is set", () => {
    render(
      <Input
        label="TRN"
        value=""
        onChange={() => {}}
        tooltip="Your business's Tax Registration Number, issued by the Federal Tax Authority."
      />,
    );
    expect(screen.getByText("TRN")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Tax Registration Number");
  });

  it("still renders as a normal functioning input alongside the tooltip", () => {
    render(<Input label="TRN" value="12345" onChange={() => {}} tooltip="Some help text" />);
    expect(screen.getByLabelText("TRN")).toHaveValue("12345");
  });
});
