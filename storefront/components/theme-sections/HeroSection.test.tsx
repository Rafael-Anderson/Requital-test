import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import HeroSection from "./HeroSection";
import type { SectionSettings } from "@/lib/theme-config-types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  themeConfig = null;
});

let themeConfig: unknown = null;
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ previewMode: false, shop: null, themeConfig }),
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

  describe("inset layout + dot indicators (Phase 4)", () => {
    it("no dots when showSlideIndicators is unset, even with multiple images", () => {
      const { container } = renderHero({ bannerImages: [{ url: IMG_A }, { url: IMG_B }] });
      expect(container.querySelectorAll("button[aria-label^='Go to slide']").length).toBe(0);
    });

    it("renders one dot per slide when showSlideIndicators is on; clicking one switches slide", () => {
      const { container } = renderHero({ bannerImages: [{ url: IMG_A }, { url: IMG_B }], showSlideIndicators: true });
      const dots = container.querySelectorAll("button[aria-label^='Go to slide']");
      expect(dots.length).toBe(2);
      fireEvent.click(dots[1]);
      expect(bannerImages()[1].style.opacity).toBe("1");
    });

    it("full-bleed by default: no max-width wrapper, no border radius on the hero", () => {
      const { container } = renderHero({ bannerImages: [{ url: IMG_A }] });
      const hero = container.querySelector(".relative.flex") as HTMLElement;
      expect(hero.style.borderRadius).toBe("");
      expect(hero.parentElement?.style.maxWidth ?? "").not.toContain("theme-max-width");
    });

    it("inset layout wraps the hero in a max-width container and rounds its corners", () => {
      const { container } = renderHero({ bannerImages: [{ url: IMG_A }], heroLayout: "inset", cornerRadius: 20 });
      const hero = container.querySelector(".relative.flex") as HTMLElement;
      expect(hero.style.borderRadius).toBe("20px");
      expect(hero.parentElement?.getAttribute("style") ?? "").toContain("theme-max-width");
    });
  });
});

describe("HeroSection CTA button hoverEffect/pressEffect (§8.7 item 1)", () => {
  function renderHeroWithCta() {
    return render(
      <HeroSection
        sectionId="sec-hero"
        settings={{} as SectionSettings}
        blocks={[{ id: "blk-cta", type: "cta", visible: true, order: 0, settings: { label: "Shop now" } }]}
      />,
    );
  }

  it("renders no extra class and no icon when buttons.primary.hoverEffect is unset (no-op)", () => {
    themeConfig = { globalSettings: { buttons: { primary: {} } } };
    renderHeroWithCta();
    const cta = screen.getByText("Shop now").closest("a")!;
    expect(cta.className).not.toContain("theme-btn-");
    expect(cta.querySelector("svg")).toBeNull();
  });

  it("applies theme-btn-sweep + relative/overflow-hidden for 'sweep'", () => {
    themeConfig = { globalSettings: { buttons: { primary: { hoverEffect: "sweep" } } } };
    renderHeroWithCta();
    const cta = screen.getByText("Shop now").closest("a")!;
    expect(cta.className).toContain("theme-btn-sweep");
    expect(cta.className).toContain("relative");
    expect(cta.className).toContain("overflow-hidden");
  });

  it("renders a trailing arrow icon for 'icon-nudge' only", () => {
    themeConfig = { globalSettings: { buttons: { primary: { hoverEffect: "icon-nudge" } } } };
    renderHeroWithCta();
    const cta = screen.getByText("Shop now").closest("a")!;
    expect(cta.querySelector("svg")).not.toBeNull();
    expect(cta.className).toContain("group");
  });

  it("applies theme-btn-press when pressEffect is true, independent of hoverEffect", () => {
    themeConfig = { globalSettings: { buttons: { primary: { hoverEffect: "shine", pressEffect: true } } } };
    renderHeroWithCta();
    const cta = screen.getByText("Shop now").closest("a")!;
    expect(cta.className).toContain("theme-btn-shine");
    expect(cta.className).toContain("theme-btn-press");
  });
});
