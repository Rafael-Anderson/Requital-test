import { describe, expect, it } from "vitest";
import { MEGA_COLUMN_GAP, MEGA_TRACK_MAX, MEGA_TRACK_MIN, megaColumnOffset, megaColumns, packMegaGroups } from "./mega-menu-layout";

describe("megaColumns", () => {
  it("fits as many tracks as the width allows, more on wider screens", () => {
    const at = (w: number) => megaColumns(w).cols;
    // The group area of a 1280, 1440, 1920 and 2560px viewport: from the 80rem container's start edge
    // plus 1rem to the viewport's end less 1rem.
    expect(at(1248)).toBe(5);
    expect(at(1328)).toBe(5);
    expect(at(1568)).toBe(6);
    expect(at(1888)).toBe(7);
  });

  it("never squeezes a track under the minimum, never stretches one past the maximum, and leaves the rest empty", () => {
    for (const w of [600, 900, 1248, 1888, 2528, 4000]) {
      const { cols, track } = megaColumns(w);
      expect(track).toBeGreaterThanOrEqual(MEGA_TRACK_MIN);
      expect(track).toBeLessThanOrEqual(MEGA_TRACK_MAX);
      expect(cols * track + (cols - 1) * MEGA_COLUMN_GAP).toBeLessThanOrEqual(w);
    }
  });

  it("a panel narrower than one track gets one column of the width it has", () => {
    expect(megaColumns(180)).toEqual({ cols: 1, track: 180 });
    expect(megaColumns(0)).toEqual({ cols: 1, track: MEGA_TRACK_MIN });
  });
});

describe("packMegaGroups", () => {
  it("places each group into the currently shortest column, start-most on a tie", () => {
    // Four columns; the second row's groups go under the shortest first-row groups.
    const { placements, height } = packMegaGroups([300, 100, 200, 150, 80, 60, 40, 200], 4, 24);
    expect(placements.slice(0, 4)).toEqual([
      { col: 0, top: 0 },
      { col: 1, top: 0 },
      { col: 2, top: 0 },
      { col: 3, top: 0 },
    ]);
    // Group 5 (80px) moves up under group 2 (100px tall, the shortest column).
    expect(placements[4]).toEqual({ col: 1, top: 124 });
    // Group 6: column 3 (150) is now shortest.
    expect(placements[5]).toEqual({ col: 3, top: 174 });
    // Group 7: column 1 is at 204, column 2 at 200: column 2.
    expect(placements[6]).toEqual({ col: 2, top: 224 });
    // Group 8: column 1 (204) beats column 2 (264), 3 (234) and 0 (300).
    expect(placements[7]).toEqual({ col: 1, top: 228 });
    expect(height).toBe(428);
  });

  it("two groups use two columns side by side; one column stacks", () => {
    expect(packMegaGroups([120, 300], 6).placements).toEqual([
      { col: 0, top: 0 },
      { col: 1, top: 0 },
    ]);
    expect(packMegaGroups([120, 300], 1, 24)).toEqual({ placements: [{ col: 0, top: 0 }, { col: 0, top: 144 }], height: 444 });
  });

  it("columns are offset by a track plus the gap", () => {
    expect(megaColumnOffset(0, 250)).toBe(0);
    expect(megaColumnOffset(3, 250)).toBe(3 * (250 + MEGA_COLUMN_GAP));
  });
});
