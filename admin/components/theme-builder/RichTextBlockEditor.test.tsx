import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import RichTextBlockEditor, { stripOuterParagraph } from "./RichTextBlockEditor";

afterEach(cleanup);

// stripOuterParagraph is the load-bearing bit for "inline" mode: it turns
// the editor's mandatory <p> wrapper back into bare inline HTML so the
// storefront can drop it straight inside <h2>/<p> without invalid nesting,
// and round-trips a legacy plain-text value byte-identical.
describe("stripOuterParagraph", () => {
  it("unwraps a single lone paragraph", () => {
    expect(stripOuterParagraph("<p>Hello</p>")).toBe("Hello");
    expect(stripOuterParagraph("<p>Hello <strong>world</strong></p>")).toBe("Hello <strong>world</strong>");
    expect(stripOuterParagraph('<p>Buy <span style="color: #ff0000">now</span></p>')).toBe(
      'Buy <span style="color: #ff0000">now</span>',
    );
  });

  it("empties an empty paragraph", () => {
    expect(stripOuterParagraph("<p></p>")).toBe("");
  });

  it("leaves multi-block content intact rather than flattening it", () => {
    expect(stripOuterParagraph("<p>one</p><p>two</p>")).toBe("<p>one</p><p>two</p>");
    expect(stripOuterParagraph("<h2>x</h2>")).toBe("<h2>x</h2>");
    expect(stripOuterParagraph("<p>a<ul><li>b</li></ul></p>")).toBe("<p>a<ul><li>b</li></ul></p>");
  });

  it("passes through already-bare inline HTML (legacy plain text)", () => {
    expect(stripOuterParagraph("Just a heading")).toBe("Just a heading");
    expect(stripOuterParagraph("")).toBe("");
  });
});

describe("RichTextBlockEditor toolbar by mode", () => {
  it("inline mode: formatting + colour + link/clear, no headings or lists", () => {
    render(<RichTextBlockEditor blockId="b1" mode="inline" value="Hi" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Bold")).toBeInTheDocument();
    expect(screen.getByLabelText("Add link")).toBeInTheDocument();
    expect(screen.queryByLabelText("Heading 1")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Bullet list")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Align center")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Font size")).not.toBeInTheDocument();
  });

  it("full mode: headings, lists, alignment and the size/font selects", () => {
    render(<RichTextBlockEditor blockId="b2" mode="full" value="Hi" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Heading 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Bullet list")).toBeInTheDocument();
    expect(screen.getByLabelText("Align center")).toBeInTheDocument();
    expect(screen.getByLabelText("Font size")).toBeInTheDocument();
  });
});
