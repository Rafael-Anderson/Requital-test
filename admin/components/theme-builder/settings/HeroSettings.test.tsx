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
    // "Show slideshow dots" is the first switch; the Ken Burns toggle is the second.
    await user.click(screen.getAllByRole("switch")[0]);
    expect(onUpdate).toHaveBeenCalledWith("showSlideIndicators", true);
  });

  it("indicator-style select writes undefined for 'dots', the value otherwise (§8.13.C item 11)", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<HeroSettings settings={{ indicatorStyle: "progress" }} onUpdate={onUpdate} />);
    await user.selectOptions(screen.getByLabelText("Slide indicator style"), "dots");
    expect(onUpdate).toHaveBeenCalledWith("indicatorStyle", undefined);
  });

  it("Ken Burns toggle writes undefined when turned off (§8.13.C item 10)", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<HeroSettings settings={{ kenBurns: true }} onUpdate={onUpdate} />);
    await user.click(screen.getAllByRole("switch")[1]);
    expect(onUpdate).toHaveBeenCalledWith("kenBurns", undefined);
  });

  it("Parallax toggle writes true/undefined and is mutually exclusive with Ken Burns (§8.13.C item 15)", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const { rerender } = render(<HeroSettings settings={{}} onUpdate={onUpdate} />);
    const parallaxRow = screen.getByText("Parallax (backdrop lags on scroll)").closest("div")!;
    await user.click(parallaxRow.querySelector('[role="switch"]')!);
    expect(onUpdate).toHaveBeenCalledWith("parallax", true);

    // when parallax is on, the Ken Burns toggle is disabled, and vice versa
    rerender(<HeroSettings settings={{ parallax: true }} onUpdate={onUpdate} />);
    expect(screen.getByText("Ken Burns effect (slow zoom on the photo)").closest("div")!.querySelector('[role="switch"]')).toBeDisabled();
    rerender(<HeroSettings settings={{ kenBurns: true }} onUpdate={onUpdate} />);
    expect(screen.getByText("Parallax (backdrop lags on scroll)").closest("div")!.querySelector('[role="switch"]')).toBeDisabled();
  });
});
