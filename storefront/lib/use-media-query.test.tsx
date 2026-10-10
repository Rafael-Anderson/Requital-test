import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useMediaQuery } from "./use-media-query";
import { useIsClient } from "./use-is-client";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }));
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe() {
  return <p data-testid="p">{String(useMediaQuery("(min-width: 640px)"))}</p>;
}

describe("hydration-safe client hooks", () => {
  it("the server render is always the conservative answer, whatever the browser would say", () => {
    stubMatchMedia(true);
    expect(renderToString(<Probe />)).toContain("false");
  });

  it("the client then reads the real answer", () => {
    stubMatchMedia(true);
    render(<Probe />);
    expect(screen.getByTestId("p").textContent).toBe("true");
  });

  it("useIsClient is false on the server and true in the browser", () => {
    function C() {
      return <p>{String(useIsClient())}</p>;
    }
    expect(renderToString(<C />)).toContain("false");
    render(<C />);
    expect(document.body.textContent).toBe("true");
  });
});
