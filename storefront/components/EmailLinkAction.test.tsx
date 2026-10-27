import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import EmailLinkAction from "./EmailLinkAction";

const token = vi.hoisted(() => ({ value: "abc" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(token.value ? `token=${token.value}` : "") }));
vi.mock("@/components/StorefrontPageShell", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

afterEach(() => {
  token.value = "abc";
  cleanup();
});

function setup(over: Partial<React.ComponentProps<typeof EmailLinkAction>> = {}) {
  const lookup = vi.fn().mockResolvedValue({ shopName: "Rose Shop" });
  const act = vi.fn().mockResolvedValue({});
  render(
    <EmailLinkAction
      heading="Unsubscribe"
      lookup={lookup}
      act={act}
      prompt={(s) => `Stop emails from ${s}?`}
      button="Unsubscribe"
      working="Working..."
      done={(s) => `Done for ${s}`}
      {...over}
    />,
  );
  return { lookup, act };
}

describe("EmailLinkAction", () => {
  it("opening the link only looks it up; the button performs the action", async () => {
    const { lookup, act } = setup();
    await screen.findByText("Stop emails from Rose Shop?");
    expect(lookup).toHaveBeenCalledWith("abc");
    expect(act).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    await screen.findByText("Done for Rose Shop");
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("shows a generic message for a missing or unknown token and never acts", async () => {
    token.value = "";
    const a = setup();
    await screen.findByText(/not valid or has expired/);
    expect(a.act).not.toHaveBeenCalled();
    cleanup();
    token.value = "zzz";
    const b = setup({ lookup: vi.fn().mockRejectedValue(new Error("404")) });
    await screen.findByText(/not valid or has expired/);
    expect(b.act).not.toHaveBeenCalled();
  });

  it("offers Try again after a failed action", async () => {
    const act = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue({});
    setup({ act });
    fireEvent.click(await screen.findByRole("button", { name: "Unsubscribe" }));
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    fireEvent.click(await screen.findByRole("button", { name: "Unsubscribe" }));
    await waitFor(() => expect(act).toHaveBeenCalledTimes(2));
  });

  it("shows the already-done state without a button", async () => {
    setup({
      lookup: vi.fn().mockResolvedValue({ shopName: "Rose Shop", confirmed: true }),
      alreadyDone: (s) => `Already ${s}`,
    });
    await screen.findByText("Already Rose Shop");
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull();
  });
});
