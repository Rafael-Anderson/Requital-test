import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewsletterSettings from "./NewsletterSettings";

vi.mock("@/lib/api", () => ({
  uploadThemeImage: vi.fn(),
  resolveImageUrl: (u: string) => u,
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));

describe("NewsletterSettings — successAnimation (§8.7 item 5)", () => {
  it("renders the Success animation toggle, off by default", () => {
    render(<NewsletterSettings settings={{}} onUpdate={vi.fn()} />);
    expect(screen.getByText("Success animation")).toBeInTheDocument();
    expect(screen.getByText(/checkmark and message scale in/i)).toBeInTheDocument();
    const row = screen.getByText("Success animation").closest("div")!;
    expect(row.querySelector('[role="switch"]')).not.toBeChecked();
  });

  it("toggling it calls onUpdate('successAnimation', true)", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<NewsletterSettings settings={{}} onUpdate={onUpdate} />);
    const row = screen.getByText("Success animation").closest("div")!;
    await user.click(row.querySelector('[role="switch"]')!);
    expect(onUpdate).toHaveBeenCalledWith("successAnimation", true);
  });

  it("reflects an existing successAnimation: true", () => {
    render(<NewsletterSettings settings={{ successAnimation: true }} onUpdate={vi.fn()} />);
    const row = screen.getByText("Success animation").closest("div")!;
    expect(row.querySelector('[role="switch"]')).toBeChecked();
  });
});
