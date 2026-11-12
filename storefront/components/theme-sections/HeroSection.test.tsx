import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import HeroSection from "./HeroSection";
import type { SectionSettings } from "@/lib/theme-config-types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  themeConfig = null;
  scrollY = 0;
  minWidthMatch = true;
});

let themeConfig: unknown = null;
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ previewMode: false, shop: null, themeConfig }),
}));

// §8.13.C item 15 parallax deps — controllable per test.
let scrollY = 0;
let minWidthMatch = true;
vi.mock("@/lib/use-scroll-value", () => ({ useScrollValue: () => ({ y: scrollY, direction: "down" }) }));
vi.mock("@/lib/use-min-width", () => ({ useMinWidth: () => minWidthMatch }));

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

  describe("kenBurns + indicatorStyle (§8.13.C items 10/11)", () => {
    it("no-op: no theme-ken-burns class and no progress bar when both keys are unset", () => {
      const { container } = renderHero({ bannerImages: [{ url: IMG_A }, { url: IMG_B }], showSlideIndicators: true });
      expect(container.querySelector(".theme-ken-burns")).toBeNull();
      expect(container.querySelector(".theme-hero-progress")).toBeNull();
      // the dot row still renders
      expect(container.querySelectorAll("button[aria-label^='Go to slide']").length).toBe(2);
    });

    it("kenBurns: true adds theme-ken-burns to the active image with an inline animationDuration", () => {
      const { container } = renderHero({ bannerImages: [{ url: IMG_A }, { url: IMG_B }], slideDuration: 4, kenBurns: true });
      const active = container.querySelector("img.theme-ken-burns") as HTMLImageElement;
      expect(active).not.toBeNull();
      expect(active.style.animationDuration).toBe("4000ms");
      // only the active image gets it
      expect(container.querySelectorAll("img.theme-ken-burns").length).toBe(1);
    });

    it("kenBurns is skipped under prefers-reduced-motion", () => {
      stubMatchMedia(true);
      const { container } = renderHero({ bannerImages: [{ url: IMG_A }], kenBurns: true });
      expect(container.querySelector(".theme-ken-burns")).toBeNull();
    });

    it("indicatorStyle: 'progress' renders the bar instead of dots (even with showSlideIndicators on)", () => {
      const { container } = renderHero({
        bannerImages: [{ url: IMG_A }, { url: IMG_B }],
        slideDuration: 6,
        showSlideIndicators: true,
        indicatorStyle: "progress",
      });
      const bar = container.querySelector(".theme-hero-progress") as HTMLElement;
      expect(bar).not.toBeNull();
      expect(bar.style.animationDuration).toBe("6000ms");
      expect(container.querySelectorAll("button[aria-label^='Go to slide']").length).toBe(0);
    });

    it("no progress bar under reduced motion", () => {
      stubMatchMedia(true);
      const { container } = renderHero({ bannerImages: [{ url: IMG_A }, { url: IMG_B }], indicatorStyle: "progress" });
      expect(container.querySelector(".theme-hero-progress")).toBeNull();
    });
  });

  describe("parallax (§8.13.C item 15)", () => {
    function backdrop(container: HTMLElement) {
      return container.querySelector("div.absolute.inset-0.overflow-hidden") as HTMLElement;
    }

    it("no-op: parallax unset ⇒ no transform on the backdrop layer", () => {
      scrollY = 400;
      const { container } = renderHero({ bannerImages: [{ url: IMG_A }] });
      expect(backdrop(container).style.transform).toBe("");
    });

    it("parallax on ⇒ the backdrop layer gets translateY(scrollY*0.15) scale(1.15)", () => {
      scrollY = 200;
      const { container } = renderHero({ bannerImages: [{ url: IMG_A }], parallax: true });
      expect(backdrop(container).style.transform).toBe("translateY(30px) scale(1.15)");
    });

    it("clamps the translate at 40px", () => {
      scrollY = 5000;
      const { container } = renderHero({ bannerImages: [{ url: IMG_A }], parallax: true });
      expect(backdrop(container).style.transform).toBe("translateY(40px) scale(1.15)");
    });

    it("skipped under reduced motion and on a sub-640px viewport", () => {
      scrollY = 300;
      stubMatchMedia(true); // reduced motion
      const { container: c1 } = renderHero({ bannerImages: [{ url: IMG_A }], parallax: true });
      expect(backdrop(c1).style.transform).toBe("");
      cleanup();
      stubMatchMedia(false);
      minWidthMatch = false; // narrow viewport
      const { container: c2 } = renderHero({ bannerImages: [{ url: IMG_A }], parallax: true });
      expect(backdrop(c2).style.transform).toBe("");
    });

    it("parallax wins over kenBurns when both are set (no .theme-ken-burns)", () => {
      scrollY = 100;
      const { container } = renderHero({ bannerImages: [{ url: IMG_A }], parallax: true, kenBurns: true });
      expect(container.querySelector(".theme-ken-burns")).toBeNull();
      expect(backdrop(container).style.transform).toContain("translateY");
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

describe("HeroSection banner height", () => {
  it("keeps the preset height class when no pixel height was set (existing shops are unchanged)", () => {
    const { container } = renderHero({ bannerImages: [{ url: IMG_A }], height: "large" });
    const hero = container.querySelector("[data-theme-hero]") as HTMLElement;
    expect(hero.className).toContain("min-h-[560px]");
    expect(hero.className).not.toContain("theme-banner-minh");
  });

  it("a pixel height replaces the preset on a hero with an image, per breakpoint, clamped", () => {
    const { container } = renderHero({ bannerImages: [{ url: IMG_A }], height: "large", heightPx: 640, mobileHeightPx: 10 });
    const hero = container.querySelector("[data-theme-hero]") as HTMLElement;
    expect(hero.className).toContain("theme-banner-minh");
    expect(hero.className).not.toContain("min-h-[560px]");
    expect(hero.style.getPropertyValue("--theme-banner-h")).toBe("640px");
    expect(hero.style.getPropertyValue("--theme-banner-h-m")).toBe("120px");
  });

  it("is ignored on a hero without a banner image (that one keeps its content-sized floor)", () => {
    const { container } = renderHero({ bannerImages: [], heightPx: 800 });
    const hero = container.querySelector("[data-theme-hero]") as HTMLElement;
    expect(hero.className).toContain("min-h-[300px]");
    expect(hero.className).not.toContain("theme-banner-minh");
  });
});

// "Content position" (the admin's 3x3 grid) is exposed by the Hero section ONLY (audit of every
// section and block panel in admin/components/theme-builder). It stays because it visibly changes
// the render: each of the nine cells puts the content block in a different corner of the hero,
// through real flex alignment on the hero's own box.
describe("HeroSection content position (the one 3x3 grid in the builder)", () => {
  const CELLS: Array<[string, string, string]> = [
    ["top-left", "items-start", "justify-start"],
    ["top-center", "items-start", "justify-center"],
    ["top-right", "items-start", "justify-end"],
    ["center-left", "items-center", "justify-start"],
    ["center-center", "items-center", "justify-center"],
    ["center-right", "items-center", "justify-end"],
    ["bottom-left", "items-end", "justify-start"],
    ["bottom-center", "items-end", "justify-center"],
    ["bottom-right", "items-end", "justify-end"],
  ];

  it.each(CELLS)("%s aligns the content %s / %s", (position, vertical, horizontal) => {
    const { container } = renderHero({ contentPosition: position, bannerImages: [{ url: IMG_A }] });
    const hero = container.querySelector("[data-theme-hero]") as HTMLElement;
    expect(hero.className).toContain(vertical);
    expect(hero.className).toContain(horizontal);
    // the content wrapper is narrower than the hero, so the alignment has room to show
    expect(hero.lastElementChild?.className).toContain("max-w-2xl");
  });

  it("nine cells produce nine distinct renders, and an unknown value falls back to centre", () => {
    const seen = new Set<string>();
    for (const [position] of CELLS) {
      const { container, unmount } = renderHero({ contentPosition: position });
      const hero = container.querySelector("[data-theme-hero]") as HTMLElement;
      seen.add(hero.className.split(" ").filter((c) => /^(items|justify)-/.test(c)).join(" "));
      unmount();
    }
    expect(seen.size).toBe(9);
    const { container } = renderHero({ contentPosition: "nonsense" });
    expect((container.querySelector("[data-theme-hero]") as HTMLElement).className).toContain("items-center justify-center");
  });
});
