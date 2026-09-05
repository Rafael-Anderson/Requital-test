import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BlockSettingsForm from "./BlockSettingsForm";
import type { ThemeBlock } from "@/lib/types";

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => vi.fn(),
}));

const RATING_BADGE_BLOCK: ThemeBlock = {
  id: "rating-badge-0",
  type: "rating_badge",
  visible: true,
  order: 0,
  settings: { rating: 4.8, label: "2,000+ reviews" },
};

describe("BlockSettingsForm — rating_badge countUp (§8.7 item 3)", () => {
  it("renders the Animate on scroll toggle, off by default", () => {
    render(<BlockSettingsForm block={RATING_BADGE_BLOCK} onUpdate={vi.fn()} />);
    expect(screen.getByText("Animate on scroll")).toBeInTheDocument();
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(screen.getByText(/only the rating number animates, not the label/i)).toBeInTheDocument();
  });

  it("toggling it calls onUpdate('countUp', true)", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<BlockSettingsForm block={RATING_BADGE_BLOCK} onUpdate={onUpdate} />);
    const row = screen.getByText("Animate on scroll").closest("div")!;
    await user.click(within(row).getByRole("switch"));
    expect(onUpdate).toHaveBeenCalledWith("countUp", true);
  });
});
