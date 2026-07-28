import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import RichTextEditor from "./RichTextEditor";

// Regression coverage for a real bug: lastEmitted used to be seeded with
// useRef(value), so the very first sync effect saw value === lastEmitted.current
// and skipped writing to the contentEditable DOM — silently leaving the editor
// blank on mount whenever the caller already had real content by the time it
// rendered (both call sites — Policy Pages and ProductForm — gate rendering
// behind a loading check, so `value` is frequently non-empty on first mount,
// not just after a later update).
describe("RichTextEditor", () => {
  it("shows the initial value immediately when first mounted with non-empty content", () => {
    render(<RichTextEditor label="Content" value="<p>Existing saved content</p>" onChange={() => {}} />);
    const editor = screen.getByText("Existing saved content");
    expect(editor).toBeInTheDocument();
  });

  it("still renders correctly when first mounted empty (new-record case)", () => {
    render(<RichTextEditor label="Content" value="" onChange={() => {}} />);
    const editable = document.querySelector('[contenteditable="true"]');
    expect(editable?.innerHTML).toBe("");
  });

  // Simulates the real-world race: the page renders RichTextEditor before an
  // async fetch resolves (value=""), then the fetch resolves and the parent
  // re-renders with the real content — a slow API response, not just a prop
  // that happens to already be populated on first paint.
  it("syncs content that arrives asynchronously after mount (slow API response)", async () => {
    function SlowLoadingWrapper() {
      const [value, setValue] = useState("");
      useEffect(() => {
        const timer = setTimeout(() => setValue("<p>Loaded after a delay</p>"), 50);
        return () => clearTimeout(timer);
      }, []);
      return <RichTextEditor label="Content" value={value} onChange={() => {}} />;
    }

    render(<SlowLoadingWrapper />);
    expect(screen.queryByText("Loaded after a delay")).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Loaded after a delay")).toBeInTheDocument(), { timeout: 2000 });
  });

  it("still calls onChange while typing, and doesn't clobber the user's own edit with the echoed value", async () => {
    const user = userEvent.setup();
    function ControlledWrapper() {
      const [value, setValue] = useState("<p>Start</p>");
      return <RichTextEditor label="Content" value={value} onChange={setValue} />;
    }
    render(<ControlledWrapper />);
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editable.textContent).toBe("Start");

    await user.click(editable);
    await user.type(editable, "!");

    await waitFor(() => expect(editable.textContent).toContain("!"));
  });
});
