import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import ScrollFade from "./ScrollFade";

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
const shown = (c: HTMLElement, edge: string) => c.querySelector(`[data-fade="${edge}"]`)?.className.includes("opacity-100");

describe("ScrollFade", () => {
  it("shows the end fade only while content is hidden past the end", () => {
    const { container, scroller } = setup(500, 300);
    fireEvent.scroll(scroller);
    expect(shown(container, "end")).toBe(true);
    expect(shown(container, "start")).toBe(false);
    scroller.scrollLeft = 100;
    fireEvent.scroll(scroller);
    expect(shown(container, "start")).toBe(true);
    expect(shown(container, "end")).toBe(true);
    scroller.scrollLeft = 200;
    fireEvent.scroll(scroller);
    expect(shown(container, "end")).toBe(false);
  });

  it("treats a negative scrollLeft (RTL) the same way", () => {
    const { container, scroller } = setup(500, 300);
    scroller.scrollLeft = -120;
    fireEvent.scroll(scroller);
    expect(shown(container, "start")).toBe(true);
  });

  it("shows nothing when the content fits, and can drop the start fade", () => {
    const { container, scroller } = setup(300, 300);
    fireEvent.scroll(scroller);
    expect(shown(container, "end")).toBe(false);
    expect(setup(500, 300, false).container.querySelector('[data-fade="start"]')).toBeNull();
  });
});
