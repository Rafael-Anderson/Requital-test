import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import PreviewSectionOutline from "./PreviewSectionOutline";
import SectionWrapper from "./theme-sections/SectionWrapper";
import { parseSectionSelectMessage } from "@/lib/preview-section-selection";

const shopState = { previewMode: true, themeConfig: null };
vi.mock("@/lib/shop-context", () => ({ useShop: () => shopState }));

const ADMIN = "http://localhost:3001";

function fromAdmin(data: unknown, origin = ADMIN) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin }));
  });
}

function placeSection(id: string, rect: { top: number; left: number; width: number; height: number }) {
  const el = document.createElement("section");
  el.setAttribute("data-requital-section-id", id);
  el.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON() {} }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

async function nextFrames() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

beforeEach(() => {
  shopState.previewMode = true;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("parseSectionSelectMessage", () => {
  it("reads a selection, a clear, and ignores anything else", () => {
    expect(parseSectionSelectMessage({ type: "preview-select-section", sectionId: "sec-1", label: "Hero", color: "#0f766e" })).toEqual({
      sectionId: "sec-1",
      label: "Hero",
      color: "#0f766e",
    });
    expect(parseSectionSelectMessage({ type: "preview-select-section", sectionId: null })).toBeNull();
    expect(parseSectionSelectMessage({ type: "theme-config-update" })).toBeUndefined();
    // An id that is not a builder id is never used as a selector.
    expect(parseSectionSelectMessage({ type: "preview-select-section", sectionId: '"] , body, [x="' })).toBeUndefined();
    // A colour that is not a hex falls back to the builder accent.
    expect(parseSectionSelectMessage({ type: "preview-select-section", sectionId: "s", color: "red;x:url(a)" })?.color).toBe("#0f766e");
  });
});

describe("PreviewSectionOutline", () => {
  it("outlines the section the admin selected, with its name chip, without touching the section", async () => {
    const section = placeSection("sec-rich", { top: 120, left: 0, width: 800, height: 300 });
    render(<PreviewSectionOutline />);
    fromAdmin({ type: "preview-select-section", sectionId: "sec-rich", label: "Rich Text", color: "#0f766e" });
    await nextFrames();

    const outline = screen.getByTestId("preview-section-outline");
    expect(outline).toHaveAttribute("data-section-id", "sec-rich");
    expect(outline.style.top).toBe("120px");
    expect(outline.style.height).toBe("300px");
    expect(outline.style.outline).toContain("2px solid");
    expect(outline.className).toContain("pointer-events-none");
    expect(screen.getByTestId("preview-section-chip")).toHaveTextContent("Rich Text");
    // An overlay, not a border on the section: the section's own box is untouched.
    expect(section.getAttribute("style")).toBeNull();
    expect(section.contains(outline)).toBe(false);
  });

  it("moves to a newly selected section and clears on null", async () => {
    placeSection("a", { top: 50, left: 0, width: 500, height: 100 });
    placeSection("b", { top: 400, left: 0, width: 500, height: 200 });
    render(<PreviewSectionOutline />);
    fromAdmin({ type: "preview-select-section", sectionId: "a", label: "Hero" });
    await nextFrames();
    expect(screen.getByTestId("preview-section-outline").style.top).toBe("50px");
    fromAdmin({ type: "preview-select-section", sectionId: "b", label: "Newsletter Signup" });
    await nextFrames();
    expect(screen.getByTestId("preview-section-outline").style.top).toBe("400px");
    fromAdmin({ type: "preview-select-section", sectionId: null });
    await nextFrames();
    expect(screen.queryByTestId("preview-section-outline")).toBeNull();
  });

  it("draws nothing for a section that is not on this page, and ignores an untrusted origin", async () => {
    placeSection("a", { top: 50, left: 0, width: 500, height: 100 });
    render(<PreviewSectionOutline />);
    fromAdmin({ type: "preview-select-section", sectionId: "a", label: "Hero" }, "https://evil.example.com");
    await nextFrames();
    expect(screen.queryByTestId("preview-section-outline")).toBeNull();
    fromAdmin({ type: "preview-select-section", sectionId: "a", label: "Hero" });
    await nextFrames();
    expect(screen.getByTestId("preview-section-outline")).toBeInTheDocument();
    fromAdmin({ type: "preview-select-section", sectionId: "elsewhere", label: "Footer" });
    await nextFrames();
    expect(screen.queryByTestId("preview-section-outline")).toBeNull();
  });
});

describe("SectionWrapper click in the preview", () => {
  it("sends the section id and its box to the admin", () => {
    Object.defineProperty(document, "referrer", { value: `${ADMIN}/theme/1/builder`, configurable: true });
    const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    const { container } = render(
      <SectionWrapper sectionId="sec-click" settings={{}}>
        <p>content</p>
      </SectionWrapper>,
    );
    const section = container.querySelector("section")!;
    section.getBoundingClientRect = () => ({ top: 10, left: 20, width: 300, height: 90, right: 320, bottom: 100, x: 20, y: 10, toJSON() {} }) as DOMRect;
    fireEvent.click(section);
    expect(post).toHaveBeenCalledWith(
      { type: "theme-section-selected", sectionId: "sec-click", rect: { top: 10, left: 20, width: 300, height: 90 } },
      ADMIN,
    );
    Object.defineProperty(document, "referrer", { value: "", configurable: true });
  });

  it("is inert on the public storefront: no click handler, no preview attributes", () => {
    shopState.previewMode = false;
    const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    const { container } = render(
      <SectionWrapper sectionId="sec-public" settings={{}}>
        <p>content</p>
      </SectionWrapper>,
    );
    const section = container.querySelector("section")!;
    fireEvent.click(section);
    expect(post).not.toHaveBeenCalled();
    expect(section.hasAttribute("data-requital-section-id")).toBe(false);
  });
});
