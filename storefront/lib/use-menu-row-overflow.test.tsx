import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { linesFromTops, useMenuRowOverflow } from "./use-menu-row-overflow";

describe("linesFromTops", () => {
  it("everything on one line fits", () => {
    expect(linesFromTops([10, 10, 10.4, 11])).toEqual({ fitCount: 4, rows: 1 });
  });
  it("counts the first line and every line", () => {
    expect(linesFromTops([0, 0, 0, 36, 36, 72])).toEqual({ fitCount: 3, rows: 3 });
  });
  it("an empty menu has no lines", () => {
    expect(linesFromTops([])).toEqual({ fitCount: 0, rows: 0 });
  });
  it("a copy that is not rendered (all rects at 0) is one line: nothing overflows", () => {
    expect(linesFromTops([0, 0, 0, 0])).toEqual({ fitCount: 4, rows: 1 });
  });
});

// jsdom has no layout: each measured child reports the top its data-top attribute says.
let observers: Array<{ cb: () => void; targets: Element[] }> = [];
class FakeResizeObserver {
  entry: { cb: () => void; targets: Element[] };
  constructor(cb: () => void) {
    this.entry = { cb, targets: [] };
    observers.push(this.entry);
  }
  observe(el: Element) {
    this.entry.targets.push(el);
  }
  disconnect() {
    observers = observers.filter((o) => o !== this.entry);
  }
}

function Probe({ tops }: { tops: number[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { fitCount, rows, overflowing } = useMenuRowOverflow(ref, tops.join(","));
  return (
    <>
      <div ref={ref}>
        {tops.map((t, i) => (
          <span key={i} data-top={t} />
        ))}
      </div>
      <output data-testid="out">{`${fitCount}|${rows}|${overflowing}`}</output>
    </>
  );
}

function rectFromAttr(this: Element) {
  const top = Number(this.getAttribute("data-top") ?? 0);
  return { top, bottom: top + 30, left: 0, right: 0, width: 0, height: 30, x: 0, y: top, toJSON() {} } as DOMRect;
}

describe("useMenuRowOverflow", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    observers = [];
  });

  it("measures before paint, reports overflow, and observes the copy and each item", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(rectFromAttr);
    render(<Probe tops={[0, 0, 40, 40, 80]} />);
    expect(screen.getByTestId("out").textContent).toBe("2|3|true");
    // The copy itself plus its five items.
    expect(observers[0].targets).toHaveLength(6);
  });

  it("no overflow when everything fits", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(rectFromAttr);
    render(<Probe tops={[0, 0]} />);
    expect(screen.getByTestId("out").textContent).toBe("2|1|false");
  });

  it("re-measures when an observed size changes (a font arriving, a rotation)", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(rectFromAttr);
    const { container } = render(<Probe tops={[0, 0, 0]} />);
    expect(screen.getByTestId("out").textContent).toBe("3|1|false");
    // The items now wrap (wider glyphs): same DOM, new layout.
    const spans = container.querySelectorAll("span");
    spans[2].setAttribute("data-top", "40");
    act(() => observers[0].cb());
    expect(screen.getByTestId("out").textContent).toBe("2|2|true");
  });

  it("re-measures on window resize and stops listening on unmount", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(rectFromAttr);
    const remove = vi.spyOn(window, "removeEventListener");
    const { container, unmount } = render(<Probe tops={[0, 40]} />);
    expect(screen.getByTestId("out").textContent).toBe("1|2|true");
    container.querySelectorAll("span")[1].setAttribute("data-top", "0");
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByTestId("out").textContent).toBe("2|1|false");
    unmount();
    expect(remove.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["resize", "orientationchange"]));
  });
});
