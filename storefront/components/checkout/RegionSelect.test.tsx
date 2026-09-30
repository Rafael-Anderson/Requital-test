import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RegionSelect from "./RegionSelect";

afterEach(cleanup);

const ctx = vi.hoisted(() => ({
  value: {
    regions: [] as { id: number; code: string; nameEn: string; nameAr: string; sortOrder: number }[],
    regionLabel: "Region",
  },
}));
vi.mock("@/lib/shop-context", () => ({ useShop: () => ctx.value }));

const UAE = [
  { id: 1, code: "AE-AZ", nameEn: "Abu Dhabi", nameAr: "أبوظبي", sortOrder: 1 },
  { id: 2, code: "AE-DU", nameEn: "Dubai", nameAr: "دبي", sortOrder: 2 },
];

describe("RegionSelect", () => {
  it("offers the shop's own regions under the country's label, and selects nothing by default", () => {
    ctx.value = { regions: UAE, regionLabel: "Emirate" };
    render(<RegionSelect value={null} onChange={() => {}} />);
    expect(screen.getByText("Emirate")).toBeInTheDocument();
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe(""); // no silent "Dubai"
    expect(screen.getByRole("option", { name: "Select emirate" })).toBeDisabled();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Select emirate", "Abu Dhabi", "Dubai"]);
  });

  it("is required by default, so the browser blocks a submit that left it blank", () => {
    ctx.value = { regions: UAE, regionLabel: "Emirate" };
    render(<RegionSelect value={null} onChange={() => {}} />);
    expect(screen.getByRole("combobox")).toBeRequired();
  });

  it("reports the chosen region as a number, never a name", async () => {
    ctx.value = { regions: UAE, regionLabel: "Emirate" };
    const onChange = vi.fn();
    render(<RegionSelect value={null} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "Dubai");
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("renders nothing for a shop whose country has no regions", () => {
    ctx.value = { regions: [], regionLabel: "Region" };
    const { container } = render(<RegionSelect value={null} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
