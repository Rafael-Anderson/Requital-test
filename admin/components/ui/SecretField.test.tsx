import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import SecretField from "./SecretField";

afterEach(cleanup);

// Covers the scope's explicit "no secret value appears in rendered DOM"
// requirement — the backend half of the same check lives in
// backend/test/payment-settings.e2e-spec.ts / whatsapp-settings.e2e-spec.ts.
describe("SecretField", () => {
  const REAL_SECRET = "sk_live_super_secret_do_not_leak";
  const MASKED = "••••leak";

  it("never renders the real secret value in the DOM once a masked value exists", () => {
    render(<SecretField label="API Key" masked={MASKED} value="" onChange={vi.fn()} />);
    // Only the masked placeholder is visible — no input carrying the real
    // value, no text node containing it anywhere in the rendered tree.
    expect(screen.getByText(MASKED)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(REAL_SECRET);
    expect(document.querySelector(`[value="${REAL_SECRET}"]`)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows a real (but empty) input, not the old value, once Replace is clicked", async () => {
    const user = userEvent.setup();
    render(<SecretField label="API Key" masked={MASKED} value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Replace" }));

    expect(screen.queryByText(MASKED)).not.toBeInTheDocument();
    const input = screen.getByLabelText("API Key") as HTMLInputElement;
    expect(input).toHaveAttribute("type", "password");
    expect(input.value).toBe("");
  });

  it("opens directly into edit mode when nothing has ever been saved (masked is null)", () => {
    render(<SecretField label="API Key" masked={null} value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace" })).not.toBeInTheDocument();
  });

  it("re-collapses back to the masked view once a save round-trip updates the masked prop", () => {
    const { rerender } = render(
      <SecretField label="API Key" masked={null} value="sk_new_value" onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();

    // Simulates the parent refetching after a successful save — masked
    // flips from null to a real value, value resets to "".
    rerender(<SecretField label="API Key" masked="••••alue" value="" onChange={vi.fn()} />);

    expect(screen.getByText("••••alue")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("sk_new_value");
  });
});
