import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import ScrollFade, { fadeEdges } from "./ScrollFade";

describe("fadeEdges", () => {
  it("fades only the end edge at the start of a scroller", () => {
    expect(fadeEdges(0, 100, 300)).toEqual({ lo: false, hi: true });
  });
  it("fades both edges in the middle", () => {
    expect(fadeEdges(80, 100, 300)).toEqual({ lo: true, hi: true });
  });
  it("fades only the start edge at the end", () => {
    expect(fadeEdges(200, 100, 300)).toEqual({ lo: true, hi: false });
  });
  it("fades nothing when the content fits", () => {
    expect(fadeEdges(0, 300, 300)).toEqual({ lo: false, hi: false });
    expect(fadeEdges(0, 300, 300.5)).toEqual({ lo: false, hi: false });
  });
  it("swaps the physical edges for an RTL scroller (negative scrollLeft)", () => {
    expect(fadeEdges(0, 100, 300, true)).toEqual({ lo: true, hi: false });
    expect(fadeEdges(-200, 100, 300, true)).toEqual({ lo: false, hi: true });
  });
});

describe("ScrollFade", () => {
  it("is a horizontal scroll container carrying the fade hook", () => {
    const { container } = render(<ScrollFade>content</ScrollFade>);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute("data-scroll-fade");
    expect(el.className).toContain("overflow-x-auto");
    expect(el.className).toContain("scroll-fade");
  });

  it("updates the edge flags as it is scrolled", () => {
    // jsdom has no layout, so size the element before the effect measures it.
    const proto = HTMLElement.prototype;
    const cw = Object.getOwnPropertyDescriptor(proto, "clientWidth");
    const sw = Object.getOwnPropertyDescriptor(proto, "scrollWidth");
    Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => 100 });
    Object.defineProperty(proto, "scrollWidth", { configurable: true, get: () => 300 });
    try {
      const { container } = render(<ScrollFade>wide</ScrollFade>);
      const el = container.firstElementChild as HTMLElement;
      expect(el.dataset.fadeLo).toBe("0");
      expect(el.dataset.fadeHi).toBe("1");
      // the visible width, for full-width rows (empty / error states) inside a wide table
      expect(el.style.getPropertyValue("--sf-w")).toBe("100px");
      Object.defineProperty(el, "scrollLeft", { configurable: true, writable: true, value: 100 });
      fireEvent.scroll(el);
      expect(el.dataset.fadeLo).toBe("1");
      expect(el.dataset.fadeHi).toBe("1");
      el.scrollLeft = 200;
      fireEvent.scroll(el);
      expect(el.dataset.fadeLo).toBe("1");
      expect(el.dataset.fadeHi).toBe("0");
    } finally {
      if (cw) Object.defineProperty(proto, "clientWidth", cw);
      else delete (proto as unknown as Record<string, unknown>).clientWidth;
      if (sw) Object.defineProperty(proto, "scrollWidth", sw);
      else delete (proto as unknown as Record<string, unknown>).scrollWidth;
    }
  });

  it("centres the active item in view on mount", () => {
    const rect = (left: number, width: number) => ({ left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON() {} }) as DOMRect;
    // The scroller is rendered first, then measured: size it from the ref before the effect runs
    // by stubbing the prototype for the duration of the render.
    const orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.hasAttribute("data-scroll-fade")) return rect(0, 100);
      if (this.getAttribute("aria-current") === "page") return rect(300, 60); // centre 330, scroller centre 50
      return orig.call(this);
    };
    try {
      const { container } = render(
        <ScrollFade activeSelector='[aria-current="page"]'>
          <a aria-current="page">Active</a>
        </ScrollFade>,
      );
      const el = container.firstElementChild as HTMLElement;
      expect(el.scrollLeft).toBe(280);
    } finally {
      Element.prototype.getBoundingClientRect = orig;
    }
  });

  it("does not move when there is no active item", () => {
    const { container } = render(<ScrollFade activeSelector='[aria-current="page"]'>x</ScrollFade>);
    expect((container.firstElementChild as HTMLElement).scrollLeft).toBe(0);
  });
});


// Ported from the settings-sidebar version of this component (U1): the same behaviours, expressed
// through the data attributes the mask reads (data-fade-lo = start edge, data-fade-hi = end edge).
afterEach(cleanup);

function setup(scrollWidth: number, clientWidth: number, startFade?: boolean) {
  const r = render(
    <ScrollFade startFade={startFade}>
      <div>content</div>
    </ScrollFade>,
  );
  const scroller = r.container.querySelector("[data-scroll-fade]") as HTMLElement;
  Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(scroller, "clientWidth", { configurable: true, value: clientWidth });
  return { ...r, scroller };
}
const on = (el: HTMLElement, edge: "lo" | "hi") => el.dataset[edge === "lo" ? "fadeLo" : "fadeHi"] === "1";
// An edge's fade is actually painted only when its flag is set AND the start fade is not disabled.
const startPainted = (el: HTMLElement) => on(el, "lo") && !el.hasAttribute("data-no-start-fade");

describe("ScrollFade (ported)", () => {
  it("shows the end fade only while content is hidden past the end", () => {
    const { scroller } = setup(500, 300);
    fireEvent.scroll(scroller);
    expect(on(scroller, "hi")).toBe(true);
    expect(startPainted(scroller)).toBe(false);
    scroller.scrollLeft = 100;
    fireEvent.scroll(scroller);
    expect(startPainted(scroller)).toBe(true);
    expect(on(scroller, "hi")).toBe(true);
    scroller.scrollLeft = 200;
    fireEvent.scroll(scroller);
    expect(on(scroller, "hi")).toBe(false);
  });

  it("treats a negative scrollLeft (RTL) the same way", () => {
    const { scroller } = setup(500, 300);
    scroller.scrollLeft = -120;
    fireEvent.scroll(scroller);
    expect(on(scroller, "lo")).toBe(true);
  });

  it("shows nothing when the content fits", () => {
    const { scroller } = setup(300, 300);
    fireEvent.scroll(scroller);
    expect(on(scroller, "hi")).toBe(false);
    expect(on(scroller, "lo")).toBe(false);
  });

  it("startFade={false} never paints the start fade but keeps the end fade", () => {
    const { scroller } = setup(500, 300, false);
    scroller.scrollLeft = 100;
    fireEvent.scroll(scroller);
    expect(on(scroller, "lo")).toBe(true);
    expect(startPainted(scroller)).toBe(false);
    expect(on(scroller, "hi")).toBe(true);
    // default keeps it
    expect(setup(500, 300).scroller.hasAttribute("data-no-start-fade")).toBe(false);
  });

  it("a sticky-first table also never paints the start fade", () => {
    const { container } = render(<ScrollFade stickyFirst>x</ScrollFade>);
    expect((container.firstElementChild as HTMLElement).hasAttribute("data-no-start-fade")).toBe(true);
  });
});
