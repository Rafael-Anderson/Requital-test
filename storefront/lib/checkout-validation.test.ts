import { describe, expect, it } from "vitest";
import { missingRequiredFields } from "./checkout-validation";

const base = {
  orderType: "delivery",
  customerName: "Sam",
  customerPhone: "0501234567",
  customerAddress: "1 Palm St",
  regionId: 1 as number | null,
  hasRegions: true,
  regionLabel: "Emirate",
};

describe("missingRequiredFields", () => {
  it("a complete delivery order misses nothing", () => {
    expect(missingRequiredFields(base)).toEqual([]);
  });
  it("lists what is missing in page order, with the DOM ids", () => {
    expect(
      missingRequiredFields({ ...base, customerName: " ", customerPhone: "", customerAddress: "", regionId: null }),
    ).toEqual([
      { id: "checkout-name", label: "Name" },
      { id: "checkout-phone", label: "Phone" },
      { id: "checkout-address", label: "Full address" },
      { id: "checkout-region", label: "Emirate" },
    ]);
  });
  it("pickup needs only a name and a phone", () => {
    expect(missingRequiredFields({ ...base, orderType: "pickup", customerAddress: "", regionId: null })).toEqual([]);
  });
  it("a country without regions never asks for one", () => {
    expect(missingRequiredFields({ ...base, hasRegions: false, regionId: null })).toEqual([]);
  });
});
