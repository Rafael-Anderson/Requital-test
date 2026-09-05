import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import TrustBarSection from "./TrustBarSection";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

// jsdom has no IntersectionObserver — same controllable FakeIO stub as
// ScrollAnimatedWrapper.test.tsx, copied in (that file's instance isn't
// reachable from here, and this is a small, self-contained pattern).
let ioInstances: Array<{ cb: IntersectionObserverCallback; el: Element | null }>;

class FakeIO {
  cb: IntersectionObserverCallback;
  el: Element | null = null;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    ioInstances.push(this);
  }
  observe(el: Element) {
    this.el = el;
  }
  unobserve() {
    this.el = null;
  }
  disconnect() {
    this.el = null;
  }
}

function fireIntersect(isIntersecting: boolean) {
  act(() => {
    for (const io of ioInstances) {
      if (io.el || isIntersecting) {
        io.cb([{ isIntersecting } as IntersectionObserverEntry], io as unknown as IntersectionObserver);
      }
    }
  });
}

// Same rAF-with-incrementing-timestamp stub as use-count-up.test.tsx, so the
// count-up animation fast-forwards to completion synchronously.
let clock = 0;
function stubSyncRaf() {
  clock = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    clock += 16;
    cb(clock);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
}

function stubMatchMedia(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: reduced,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

beforeEach(() => {
  ioInstances = [];
  vi.stubGlobal("IntersectionObserver", FakeIO);
  stubMatchMedia(false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const B = (type: string, settings: Record<string, unknown>, order = 0): ThemeBlock => ({
  id: `${type}-${order}`,
  type,
  visible: true,
  order,
  settings,
});

function renderTrustBar(blocks: ThemeBlock[]) {
  return render(<TrustBarSection sectionId="s" settings={{} as SectionSettings} blocks={blocks} />);
}

describe("TrustBarSection", () => {
  it("renders nothing when there is no visible content", () => {
    const { container } = renderTrustBar([]);
    expect(container.firstChild).toBeNull();
  });

  it("renders trust items with their text", () => {
    const { getByText } = renderTrustBar([
      B("trust_item", { text: "Same-day delivery", icon: "truck" }, 0),
      B("trust_item", { text: "Fresh guarantee", icon: "shield" }, 1),
    ]);
    expect(getByText("Same-day delivery")).toBeInTheDocument();
    expect(getByText("Fresh guarantee")).toBeInTheDocument();
  });

  it("renders a rating badge (number + 5 stars) and links it when a url is set", () => {
    const { getByText, container } = renderTrustBar([
      B("rating_badge", { rating: 4.7, label: "1,200 reviews", url: "https://reviews.example" }, 0),
    ]);
    expect(getByText("4.7")).toBeInTheDocument();
    expect(getByText("· 1,200 reviews")).toBeInTheDocument();
    const link = container.querySelector("a[href='https://reviews.example']");
    expect(link).not.toBeNull();
    expect(link!.querySelectorAll("svg").length).toBe(5);
  });

  it("skips a hidden block", () => {
    const { queryByText } = renderTrustBar([
      { ...B("trust_item", { text: "Hidden" }, 0), visible: false },
      B("trust_item", { text: "Shown" }, 1),
    ]);
    expect(queryByText("Hidden")).toBeNull();
    expect(queryByText("Shown")).not.toBeNull();
  });
});

describe("TrustBarSection — rating_badge countUp (§8.7 item 3)", () => {
  it("shows the final rating immediately when not yet scrolled into view (no dip to 0)", () => {
    const { getByText } = renderTrustBar([B("rating_badge", { rating: 4.8, countUp: true }, 0)]);
    expect(getByText("4.8")).toBeInTheDocument();
  });

  it("eventually shows the final rating once scrolled into view", () => {
    stubSyncRaf();
    const { getByText } = renderTrustBar([B("rating_badge", { rating: 4.8, countUp: true }, 0)]);
    fireIntersect(true);
    expect(getByText("4.8")).toBeInTheDocument();
  });

  it("never dips to 0 under reduced motion, even once scrolled into view", () => {
    stubMatchMedia(true);
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    const { getByText } = renderTrustBar([B("rating_badge", { rating: 4.8, countUp: true }, 0)]);
    fireIntersect(true);
    expect(getByText("4.8")).toBeInTheDocument();
    expect(raf).not.toHaveBeenCalled();
  });
});
