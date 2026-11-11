import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import MarqueeTrack from "./MarqueeTrack";
import { initialRepeats, marqueeDurationSeconds, MARQUEE_SPEED_DEFAULT, MARQUEE_SPEED_MAX, MARQUEE_SPEED_MIN, resolveMarqueeSpeed } from "@/lib/marquee";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const css = fs.readFileSync(path.join(__dirname, "../app/globals.css"), "utf8");

function halves(container: HTMLElement) {
  const track = container.querySelector(".marquee-track") as HTMLElement;
  return { track, halves: Array.from(track.querySelectorAll(":scope > .marquee-half")) as HTMLElement[] };
}

describe("MarqueeTrack", () => {
  it("renders two identical halves, each repeating the message enough to cover a very wide bar", () => {
    const { container } = render(
      <div><MarqueeTrack plainText="Free delivery today" renderItem={() => "Free delivery today"} /></div>,
    );
    const { halves: h } = halves(container);
    expect(h).toHaveLength(2);
    const want = initialRepeats("Free delivery today");
    expect(want).toBeGreaterThan(8);
    expect(h[0].querySelectorAll(".marquee-item")).toHaveLength(want);
    expect(h[1].querySelectorAll(".marquee-item")).toHaveLength(want);
    expect(h[0].textContent).toBe(h[1].textContent);
  });

  it("only the first copy is exposed to assistive tech; the rest (and the whole second half) are hidden", () => {
    const { container } = render(<div><MarqueeTrack plainText="Hello" renderItem={() => "Hello"} /></div>);
    const { halves: h } = halves(container);
    expect(h[1].getAttribute("aria-hidden")).toBe("true");
    const items = Array.from(h[0].querySelectorAll(".marquee-item"));
    expect(items[0].getAttribute("aria-hidden")).toBeNull();
    for (const it of items.slice(1)) expect(it.getAttribute("aria-hidden")).toBe("true");
  });

  it("adds copies when the measured bar is wider than the estimate assumed, and never removes any", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(20000);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100);
    const { container } = render(<div><MarqueeTrack plainText="Hello" renderItem={() => "Hello"} /></div>);
    const { halves: h } = halves(container);
    expect(h[0].querySelectorAll(".marquee-item")).toHaveLength(200); // ceil(20000 / 100)
    expect(h[1].querySelectorAll(".marquee-item")).toHaveLength(200);

    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100);
    const small = render(<div><MarqueeTrack plainText="Hello" renderItem={() => "Hello"} /></div>);
    expect(halves(small.container).halves[0].querySelectorAll(".marquee-item")).toHaveLength(initialRepeats("Hello"));
  });
});

describe("marquee CSS", () => {
  it("loops by exactly one half: translateX(-50%), and +50% in RTL", () => {
    expect(css).toMatch(/@keyframes marquee-scroll \{[\s\S]*?from \{\s*transform: translateX\(0\);\s*\}\s*to \{\s*transform: translateX\(-50%\);/);
    expect(css).toMatch(/@keyframes marquee-scroll-rtl \{[\s\S]*?to \{\s*transform: translateX\(50%\);/);
    expect(css).toMatch(/\[dir="rtl"\] \.marquee-track \{\s*animation-name: marquee-scroll-rtl;/);
  });

  it("reduced motion: no animation, one copy, centred", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n  .marquee-track"));
    expect(block).toMatch(/animation: none;/);
    expect(block).toMatch(/justify-content: center;/);
    expect(block).toMatch(/\.marquee-track > \[aria-hidden="true"\] \{\s*display: none;/);
    expect(block).toMatch(/\.marquee-half > \.marquee-item ~ \.marquee-item \{\s*display: none;/);
  });
});

// Real layout is not available in jsdom, so the half's width is injected: a half is
// `repeats x item width` wide, exactly what the browser would report.
function renderMeasured(plainText: string, itemWidth: number, barWidth: number, speed?: number | null) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(barWidth);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("marquee-half")) return this.querySelectorAll(".marquee-item").length * itemWidth;
    return itemWidth;
  });
  const { container } = render(
    <div><MarqueeTrack plainText={plainText} renderItem={() => plainText} speedPxPerSec={speed} /></div>,
  );
  const track = container.querySelector(".marquee-track") as HTMLElement;
  const half = track.querySelector(".marquee-half") as HTMLElement;
  const seconds = parseFloat(track.style.getPropertyValue("--marquee-duration"));
  return { seconds, halfWidth: half.offsetWidth };
}

describe("marquee speed is constant px/second", () => {
  it("resolves the default, clamps to the allowed range and ignores junk", () => {
    expect(MARQUEE_SPEED_DEFAULT).toBe(40);
    expect(resolveMarqueeSpeed(undefined)).toBe(40);
    expect(resolveMarqueeSpeed(null)).toBe(40);
    expect(resolveMarqueeSpeed("80")).toBe(40);
    expect(resolveMarqueeSpeed(NaN)).toBe(40);
    expect(resolveMarqueeSpeed(1)).toBe(MARQUEE_SPEED_MIN);
    expect(resolveMarqueeSpeed(9999)).toBe(MARQUEE_SPEED_MAX);
    expect(resolveMarqueeSpeed(75)).toBe(75);
  });

  it("duration = half width / speed", () => {
    expect(marqueeDurationSeconds(4000, 40)).toBe(100);
    expect(marqueeDurationSeconds(4000, 80)).toBe(50);
    expect(marqueeDurationSeconds(0, 40)).toBe(0);
  });

  it("a long message and a short one, on a narrow bar and a wide one, all move at the same px/s", () => {
    const cases: Array<[string, number, number]> = [
      ["Hi", 60, 320],
      ["Free same-day delivery across Dubai on every order placed before 3pm", 520, 320],
      ["Hi", 60, 2560],
      ["Free same-day delivery across Dubai on every order placed before 3pm", 520, 2560],
    ];
    for (const [text, itemWidth, barWidth] of cases) {
      const { seconds, halfWidth } = renderMeasured(text, itemWidth, barWidth);
      expect(halfWidth / seconds).toBeCloseTo(MARQUEE_SPEED_DEFAULT, 0);
      cleanup();
      vi.restoreAllMocks();
    }
  });

  it("a merchant speed changes px/s, and null means the default", () => {
    const fast = renderMeasured("Hello", 100, 1000, 120);
    expect(fast.halfWidth / fast.seconds).toBeCloseTo(120, 0);
    cleanup();
    vi.restoreAllMocks();
    const dflt = renderMeasured("Hello", 100, 1000, null);
    expect(dflt.halfWidth / dflt.seconds).toBeCloseTo(40, 0);
  });

  it("the CSS animation reads the per-track duration, falling back to the motion token (Brands strip)", () => {
    expect(css).toMatch(/\.marquee-track \{[^}]*animation: marquee-scroll var\(--marquee-duration, var\(--motion-marquee-duration, 18s\)\) linear infinite;/);
  });
});
