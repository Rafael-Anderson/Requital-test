import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import AnnouncementBarSectionThemed from "./AnnouncementBarSectionThemed";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ previewMode: false }),
}));

// jsdom has no real matchMedia implementation — the component calls it to
// check prefers-reduced-motion, defaulted here to "not reduced" so rotation
// actually runs.
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

function announcementBlock(id: string, order: number, text: string): ThemeBlock {
  return { id, type: "announcement", visible: true, order, settings: { text } };
}

describe("AnnouncementBarSectionThemed rotation", () => {
  it("rotates to the next message after one interval + fade tick, at the configured speed", async () => {
    vi.useFakeTimers();
    const settings = { scrolling: false, speed: "fast" } as unknown as SectionSettings;
    const blocks = [announcementBlock("blk-1", 0, "First message"), announcementBlock("blk-2", 1, "Second message")];

    render(<AnnouncementBarSectionThemed sectionId="sec-1" settings={settings} blocks={blocks} />);

    expect(screen.getByText("First message")).toBeInTheDocument();

    // "fast" => 2000ms tick (starts the fade-out), then 400ms more for the
    // fade to complete and the index to actually advance.
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByText("Second message")).toBeInTheDocument();
    expect(screen.queryByText("First message")).not.toBeInTheDocument();
  });

  it("does not rotate — messages are joined onto one line — when Scrolling is on", async () => {
    vi.useFakeTimers();
    const settings = { scrolling: true } as unknown as SectionSettings;
    const blocks = [announcementBlock("blk-1", 0, "First message"), announcementBlock("blk-2", 1, "Second message")];

    render(<AnnouncementBarSectionThemed sectionId="sec-1" settings={settings} blocks={blocks} />);

    await act(async () => {
      vi.advanceTimersByTime(10000);
    });

    expect(screen.getAllByText(/First message\s*•\s*Second message/).length).toBeGreaterThan(0);
  });
});
