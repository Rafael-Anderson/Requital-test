import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HeroSettings from "./HeroSettings";

vi.mock("@/lib/api", () => ({
  uploadThemeImage: vi.fn(),
  resolveImageUrl: (u: string) => u,
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));

describe("HeroSettings — Phase 4 controls", () => {
  it("renders the Layout select and the slideshow-dots toggle", () => {
    render(<HeroSettings settings={{}} onUpdate={vi.fn()} />);
    expect(screen.getByLabelText("Layout")).toBeInTheDocument();
    expect(screen.getByText("Show slideshow dots")).toBeInTheDocument();
  });

  it("shows the corner-radius input only for the inset layout", () => {
    const { rerender } = render(<HeroSettings settings={{}} onUpdate={vi.fn()} />);
    expect(screen.queryByLabelText("Corner radius (px)")).toBeNull();
    rerender(<HeroSettings settings={{ heroLayout: "inset" }} onUpdate={vi.fn()} />);
    expect(screen.getByLabelText("Corner radius (px)")).toBeInTheDocument();
  });

  it("toggling the dots calls onUpdate('showSlideIndicators', true)", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<HeroSettings settings={{}} onUpdate={onUpdate} />);
    await user.click(screen.getByRole("switch"));
    expect(onUpdate).toHaveBeenCalledWith("showSlideIndicators", true);
  });
});
