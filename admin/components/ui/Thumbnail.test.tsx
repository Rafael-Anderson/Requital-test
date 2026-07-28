import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import Thumbnail from "./Thumbnail";

// alt="" gives the <img> an accessible role of "presentation", not "img"
// (empty alt is the correct choice here — it's decorative), so these query
// by tag via the container rather than screen.getByRole("img").

describe("Thumbnail", () => {
  it("shows a placeholder icon when there's no src", () => {
    const { container } = render(<Thumbnail src={null} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders a resolved absolute URL for a backend-relative src", () => {
    const { container } = render(<Thumbnail src="/uploads/products/x.jpg" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "http://localhost:3000/uploads/products/x.jpg");
  });

  it("falls back to the placeholder once the image fails to load", () => {
    const { container } = render(<Thumbnail src="/uploads/products/x.jpg" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(container.querySelector("img")).toBeNull();
  });
});
