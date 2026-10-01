import { describe, expect, it } from "vitest";
import { changedValues, draftFromValue, valueFromDraft } from "./metafields";
import type { MetafieldDefinition } from "./types";

const def = (id: number, type: MetafieldDefinition["type"]): MetafieldDefinition => ({
  id,
  ownerType: "product",
  namespace: "custom",
  key: `k${id}`,
  name: `Field ${id}`,
  type,
  validation: null,
  displayOrder: 0,
  visibleOnStorefront: false,
});

describe("valueFromDraft", () => {
  it("treats an empty control as no value", () => {
    expect(valueFromDraft(def(1, "text"), "")).toEqual({ ok: true, value: null });
    expect(valueFromDraft(def(1, "number"), " ")).toEqual({ ok: true, value: null });
    expect(valueFromDraft(def(1, "multi_select"), [])).toEqual({ ok: true, value: null });
    expect(valueFromDraft(def(1, "boolean"), null)).toEqual({ ok: true, value: null });
  });

  it("converts typed drafts to real JSON values", () => {
    expect(valueFromDraft(def(1, "number"), "12.5")).toEqual({ ok: true, value: 12.5 });
    expect(valueFromDraft(def(1, "json"), '{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(valueFromDraft(def(1, "boolean"), false)).toEqual({ ok: true, value: false });
  });

  it("reports unparseable numbers and JSON instead of sending them", () => {
    expect(valueFromDraft(def(1, "number"), "abc").ok).toBe(false);
    expect(valueFromDraft(def(1, "json"), "{oops").ok).toBe(false);
  });
});

describe("draftFromValue", () => {
  it("round-trips each type", () => {
    for (const [type, value] of [
      ["text", "hi"],
      ["number", 4],
      ["boolean", true],
      ["json", { a: [1] }],
      ["multi_select", ["a", "b"]],
    ] as const) {
      const d = def(1, type);
      expect(valueFromDraft(d, draftFromValue(d, value))).toEqual({ ok: true, value });
    }
  });
});

describe("changedValues", () => {
  const defs = [def(1, "text"), def(2, "number"), def(3, "boolean")];
  it("sends only what changed, including a clear", () => {
    const initial = { 1: "a", 2: "5", 3: null };
    const drafts = { 1: "a", 2: "", 3: true };
    expect(changedValues(defs, initial, drafts)).toEqual({
      ok: true,
      values: [
        { definitionId: 2, value: null },
        { definitionId: 3, value: true },
      ],
    });
  });
  it("sends nothing when nothing changed", () => {
    const same = { 1: "a", 2: "5", 3: null };
    expect(changedValues(defs, same, { ...same })).toEqual({ ok: true, values: [] });
  });
  it("fails on an invalid draft", () => {
    expect(changedValues(defs, {}, { 2: "x" }).ok).toBe(false);
  });
});
