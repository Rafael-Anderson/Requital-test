import { describe, expect, it } from "vitest";
import { announcementDismissKey } from "./announcement-rotation";

describe("announcementDismissKey", () => {
  it("is stable for the same shop + same messages", () => {
    const a = announcementDismissKey("roses", ["Free delivery", "New season"]);
    const b = announcementDismissKey("roses", ["Free delivery", "New season"]);
    expect(a).toBe(b);
    expect(a.startsWith("requital_storefront_announcement_dismissed:roses:")).toBe(true);
  });

  it("changes when any message text changes (a re-worded bar re-shows)", () => {
    const a = announcementDismissKey("roses", ["Free delivery over AED 200"]);
    const b = announcementDismissKey("roses", ["Free delivery over AED 250"]);
    expect(a).not.toBe(b);
  });

  it("is scoped per shop", () => {
    expect(announcementDismissKey("shop-a", ["hi"])).not.toBe(announcementDismissKey("shop-b", ["hi"]));
  });
});
