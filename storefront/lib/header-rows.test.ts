import { describe, expect, it } from "vitest";
import { resolveHeaderRows, navMenuInHeaderRow } from "./header-rows";
import type { ThemeBlock } from "./theme-config-types";

const B = (id: string, type: string, visible = true): ThemeBlock => ({ id, type, visible, order: 0, settings: {} });

const BLOCKS: ThemeBlock[] = [
  B("logo", "logo"),
  B("nav", "nav_menu"),
  B("search", "search_icon"),
  B("cart", "cart_icon"),
  B("phone", "contact_bar_item"),
];

describe("resolveHeaderRows — regression backstop (rows absent ⇒ null ⇒ classic header unchanged)", () => {
  it("returns null when rows is absent / empty / not an array", () => {
    expect(resolveHeaderRows(undefined, BLOCKS)).toBeNull();
    expect(resolveHeaderRows({}, BLOCKS)).toBeNull();
    expect(resolveHeaderRows({ rows: [] }, BLOCKS)).toBeNull();
    expect(resolveHeaderRows({ rows: "nope" }, BLOCKS)).toBeNull();
  });

  it("returns null when rows contains no structurally-valid row", () => {
    expect(resolveHeaderRows({ rows: [null, "x", { blockIds: [] }, { id: "", blockIds: [] }, { id: "r", blockIds: "bad" }] }, BLOCKS)).toBeNull();
  });
});

describe("resolveHeaderRows — valid rows", () => {
  // minimal block set so there are no "leftover" blocks appended to the last row
  const MIN = [B("phone", "contact_bar_item"), B("logo", "logo")];

  it("resolves blockIds in order, skips ids that don't exist, defaults align to left", () => {
    const rows = resolveHeaderRows({ rows: [{ id: "r1", blockIds: ["phone", "ghost", "logo"] }] }, MIN);
    expect(rows).toHaveLength(1);
    expect(rows![0].align).toBe("left");
    expect(rows![0].blocks.map((b) => b.id)).toEqual(["phone", "logo"]);
  });

  it("honours align/background and never double-places a block across rows", () => {
    const rows = resolveHeaderRows(
      {
        rows: [
          { id: "r1", blockIds: ["phone"], align: "between", background: "#101010" },
          { id: "r2", blockIds: ["logo", "phone"], align: "center" },
        ],
      },
      MIN,
    );
    expect(rows![0]).toMatchObject({ align: "between", background: "#101010" });
    expect(rows![0].blocks.map((b) => b.id)).toEqual(["phone"]);
    expect(rows![1].blocks.map((b) => b.id)).toEqual(["logo"]); // phone already used
  });

  it("appends unplaced blocks (except nav_menu) to the last row so nothing is dropped", () => {
    const rows = resolveHeaderRows({ rows: [{ id: "r1", blockIds: ["logo"] }] }, BLOCKS);
    const lastIds = rows![rows!.length - 1].blocks.map((b) => b.id);
    expect(lastIds).toEqual(expect.arrayContaining(["search", "cart", "phone"]));
    expect(lastIds).not.toContain("nav"); // nav_menu only renders inline when explicitly placed
  });

  it("drops non-visible blocks", () => {
    const blocks = [B("logo", "logo"), B("hidden", "search_icon", false)];
    const rows = resolveHeaderRows({ rows: [{ id: "r1", blockIds: ["logo", "hidden"] }] }, blocks);
    expect(rows![0].blocks.map((b) => b.id)).toEqual(["logo"]);
  });
});

describe("navMenuInHeaderRow", () => {
  it("is true only when the nav_menu block id is explicitly in a row's blockIds", () => {
    expect(navMenuInHeaderRow({ rows: [{ id: "r1", blockIds: ["nav", "logo"] }] }, BLOCKS)).toBe(true);
    expect(navMenuInHeaderRow({ rows: [{ id: "r1", blockIds: ["logo"] }] }, BLOCKS)).toBe(false);
    expect(navMenuInHeaderRow({}, BLOCKS)).toBe(false);
    expect(navMenuInHeaderRow({ rows: [{ id: "r1", blockIds: ["logo"] }] }, [B("logo", "logo")])).toBe(false);
  });
});
