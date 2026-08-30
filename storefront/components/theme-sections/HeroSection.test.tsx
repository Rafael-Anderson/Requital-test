import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import HeroSection from "./HeroSection";
import type { SectionSettings } from "@/lib/theme-config-types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ previewMode: false, shop: null }),
}));

// jsdom has no real matchMedia — default to "motion allowed" so rotation runs;
// individual tests override matches for the reduced-motion case.
function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

beforeEach(() => stubMatchMedia(false));

const IMG_A = "https://cdn.test/a.jpg";
const IMG_B = "https://cdn.test/b.jpg";

function renderHero(settings: Partial<SectionSettings>) {
  return render(<HeroSection sectionId="sec-hero" settings={settings as SectionSettings} blocks={[]} />);
}

function bannerImages() {
  return Array.from(document.querySelectorAll("img")) as HTMLImageElement[];
}

describe("HeroSection slideshow", () => {
  it("auto-advances to the next banner image after the slide duration", async () => {
    vi.useFakeTimers();
    renderHero({ bannerImages: [{ url: IMG_A }, { url: IMG_B }], slideDuration: 3 });

    const imgs = bannerImages();
    expect(imgs).toHaveLength(2);
    expect(imgs[0].style.opacity).toBe("1");
    expect(imgs[1].style.opacity).toBe("0");

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(bannerImages()[0].style.opacity).toBe("0");
    expect(bannerImages()[1].style.opacity).toBe("1");
  });

  it("does not rotate a single image (no timer)", async () => {
    vi.useFakeTimers();
    renderHero({ bannerImages: [{ url: IMG_A }], slideDuration: 3 });

    expect(bannerImages()).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    expect(bannerImages()[0].style.opacity).toBe("1");
  });

  it("respects prefers-reduced-motion: shows the first image, never advances", async () => {
    stubMatchMedia(true);
    vi.useFakeTimers();
    renderHero({ bannerImages: [{ url: IMG_A }, { url: IMG_B }], slideDuration: 3 });

    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    expect(bannerImages()[0].style.opacity).toBe("1");
    expect(bannerImages()[1].style.opacity).toBe("0");
  });

  it("pauses rotation while hovered and resumes on mouse leave", async () => {
    vi.useFakeTimers();
    const { container } = renderHero({ bannerImages: [{ url: IMG_A }, { url: IMG_B }], slideDuration: 3 });
    const layer = container.querySelector("div.absolute.inset-0") as HTMLElement;

    fireEvent.mouseEnter(layer);
    await act(async () => {
      vi.advanceTimersByTime(9000);
    });
    expect(bannerImages()[0].style.opacity).toBe("1");

    fireEvent.mouseLeave(layer);
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(bannerImages()[1].style.opacity).toBe("1");
  });

  it("renders heroText as a caption strip below the hero", () => {
    renderHero({ heroText: "Fresh flowers, delivered same-day" });
    expect(screen.getByText("Fresh flowers, delivered same-day")).toBeInTheDocument();
  });

  it("renders nothing extra when there are no banner images", () => {
    renderHero({});
    expect(bannerImages()).toHaveLength(0);
  });
});
