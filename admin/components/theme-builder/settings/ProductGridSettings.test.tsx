import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProductGridSettings from "./ProductGridSettings";

vi.mock("@/lib/api", () => ({ listCollections: vi.fn().mockResolvedValue([]) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));

// §8.15 follow-up — the "View all display" Select. Only rendered when a
// collection is scoped and the View all button is shown.
describe("ProductGridSettings — View all display (§8.15 follow-up)", () => {
  it("'Button' writes viewAllStyle 'button'; 'Text link' writes undefined", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<ProductGridSettings settings={{ collectionId: 3, viewAllStyle: "button" }} onUpdate={onUpdate} />);
    const select = screen.getByLabelText("View all display");
    await user.selectOptions(select, "link");
    expect(onUpdate).toHaveBeenCalledWith("viewAllStyle", undefined);
    await user.selectOptions(select, "button");
    expect(onUpdate).toHaveBeenCalledWith("viewAllStyle", "button");
  });

  it("is not rendered without a scoped collection", () => {
    render(<ProductGridSettings settings={{}} onUpdate={vi.fn()} />);
    expect(screen.queryByLabelText("View all display")).toBeNull();
  });
});
