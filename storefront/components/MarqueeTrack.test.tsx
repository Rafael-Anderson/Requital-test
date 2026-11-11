import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import MarqueeTrack from "./MarqueeTrack";
import { initialRepeats } from "@/lib/marquee";

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
