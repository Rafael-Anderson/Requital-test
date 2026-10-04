import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { usePublishHeight } from "./use-publish-height";

function Bar({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  usePublishHeight(ref, "--sticky-bar-h", active);
  return <div ref={ref} style={{ height: 40 }} />;
}

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty("--sticky-bar-h");
});

describe("usePublishHeight", () => {
  it("publishes the bar's height on :root while mounted and removes it on unmount", () => {
    // jsdom has no layout: give the element a measurable height
    const orig = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => ({ height: 63.2 }) as DOMRect;
    try {
      const { unmount } = render(<Bar active />);
      expect(document.documentElement.style.getPropertyValue("--sticky-bar-h")).toBe("64px");
      unmount();
      expect(document.documentElement.style.getPropertyValue("--sticky-bar-h")).toBe("");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = orig;
    }
  });

  it("publishes nothing while inactive", () => {
    render(<Bar active={false} />);
    expect(document.documentElement.style.getPropertyValue("--sticky-bar-h")).toBe("");
  });
});
