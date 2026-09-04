import { describe, expect, it } from "vitest";
import { HEADER_PRESETS, FOOTER_PRESETS } from "./header-footer-presets";

describe("HEADER_PRESETS", () => {
  it.each(HEADER_PRESETS)("$key builds a well-formed HeaderFooterConfig with no duplicate block ids", (preset) => {
    const config = preset.build();
    const ids = config.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(config.blocks.length).toBeGreaterThan(0);
  });

  it.each(HEADER_PRESETS)("$key's rows (if any) only reference ids present in its own blocks", (preset) => {
    const config = preset.build();
    const rows = config.settings.rows as { blockIds: string[] }[] | undefined;
    if (!rows) return;
    const ids = new Set(config.blocks.map((b) => b.id));
    for (const row of rows) {
      for (const id of row.blockIds) expect(ids.has(id)).toBe(true);
    }
  });

  it("has a distinct key per preset", () => {
    const keys = HEADER_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("two calls to the same preset's build() never collide on block id", () => {
    const preset = HEADER_PRESETS[0];
    const a = preset.build();
    const b = preset.build();
    const overlap = a.blocks.map((x) => x.id).filter((id) => b.blocks.some((y) => y.id === id));
    expect(overlap).toEqual([]);
  });
});

describe("FOOTER_PRESETS", () => {
  it.each(FOOTER_PRESETS)("$key builds a well-formed HeaderFooterConfig with no duplicate block ids", (preset) => {
    const config = preset.build();
    const ids = config.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(config.blocks.length).toBeGreaterThan(0);
  });

  it("has a distinct key per preset", () => {
    const keys = FOOTER_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
