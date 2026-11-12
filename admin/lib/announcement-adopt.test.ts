import { describe, expect, it } from "vitest";
import { adoptLegacyAnnouncement } from "./announcement-adopt";

const legacyOn = { announcementBarEnabled: true, announcementBarScrolling: true, notificationText: ["Free delivery", " "] };

describe("adoptLegacyAnnouncement", () => {
  it("does nothing for a config the Announcement bar panel already manages", () => {
    expect(adoptLegacyAnnouncement({ enabled: false, managed: true, messages: [] }, legacyOn)).toBeNull();
  });

  it("copies an enabled legacy bar across when nothing is stored, dropping blank lines", () => {
    expect(adoptLegacyAnnouncement(undefined, legacyOn)).toEqual({
      enabled: true,
      managed: true,
      messages: ["Free delivery"],
      scrolling: true,
    });
  });

  it("leaves it absent when there is no stored config and no legacy bar to keep", () => {
    expect(adoptLegacyAnnouncement(undefined, { announcementBarEnabled: false, notificationText: ["x"] })).toBeNull();
    expect(adoptLegacyAnnouncement(undefined, { announcementBarEnabled: true, notificationText: [] })).toBeNull();
  });

  it("an old disabled+empty config with a live legacy bar adopts the legacy bar (what visitors see today)", () => {
    const out = adoptLegacyAnnouncement({ enabled: false, messages: [], dismissible: true }, legacyOn);
    expect(out).toMatchObject({ enabled: true, managed: true, messages: ["Free delivery"], dismissible: true });
  });

  it("any other old config is adopted as it stands, only marked managed (an explicit Off stays Off)", () => {
    expect(adoptLegacyAnnouncement({ enabled: false, messages: ["Kept"] }, legacyOn)).toEqual({
      enabled: false,
      messages: ["Kept"],
      managed: true,
    });
    expect(adoptLegacyAnnouncement({ enabled: true, messages: ["Hi"], marqueeSpeed: 80 }, {})).toEqual({
      enabled: true,
      messages: ["Hi"],
      marqueeSpeed: 80,
      managed: true,
    });
  });
});
