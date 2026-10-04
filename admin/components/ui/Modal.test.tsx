import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Modal from "./Modal";

afterEach(cleanup);

describe("Modal", () => {
  it("renders into document.body, outside the caller's subtree", () => {
    // Inside a sideways scroller (the settings columns) the scroller's edge-fade mask
    // would otherwise mask the dialog and trap it below the pinned top bar.
    const { container } = render(
      <div data-testid="scroller" style={{ maskImage: "linear-gradient(black, black)" }}>
        <Modal title="Add a thing" onClose={() => {}}>
          <p>body</p>
        </Modal>
      </div>,
    );
    const heading = screen.getByRole("heading", { name: "Add a thing" });
    expect(container.contains(heading)).toBe(false);
    expect(document.body.contains(heading)).toBe(true);
    expect(heading.closest(".fixed")?.parentElement).toBe(document.body);
  });
});
