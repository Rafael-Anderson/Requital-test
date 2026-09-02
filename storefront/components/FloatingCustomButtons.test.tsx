import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import FloatingCustomButtons from "./FloatingCustomButtons";

let themeConfigValue: unknown;
vi.mock("@/lib/shop-context", () => ({ useShop: () => ({ themeConfig: themeConfigValue }) }));
vi.mock("@/lib/api", () => ({ resolveImageUrl: (u: string | null) => u }));

afterEach(() => {
  cleanup();
  themeConfigValue = undefined;
});

function withButtons(customButtons: unknown) {
  themeConfigValue = { globalSettings: { floatingElements: { whatsapp: { enabled: false }, customButtons } } };
}

describe("FloatingCustomButtons", () => {
  it("renders nothing when there is no floatingElements config (older theme)", () => {
    const { container } = render(<FloatingCustomButtons />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for an empty or all-invalid list", () => {
    withButtons([{ id: "a", label: "" }, { url: "x" }, "garbage", null]);
    const { container } = render(<FloatingCustomButtons />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a valid button as a target=_blank link with its label", () => {
    withButtons([{ id: "rw", label: "Rewards", url: "https://rewards.example", position: "bottom_right" }]);
    const { getByRole } = render(<FloatingCustomButtons />);
    const link = getByRole("link", { name: "Rewards" });
    expect(link).toHaveAttribute("href", "https://rewards.example");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("splits buttons into left/right stacks by position", () => {
    withButtons([
      { id: "r", label: "Right one", url: "https://r" },
      { id: "l", label: "Left one", url: "https://l", position: "bottom_left" },
    ]);
    const { container } = render(<FloatingCustomButtons />);
    expect(container.querySelector(".left-5")).not.toBeNull();
    expect(container.querySelector(".right-5")).not.toBeNull();
  });
});
