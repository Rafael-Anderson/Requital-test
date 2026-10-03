import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TwoFactorCard, { type TwoFactorAdapter } from "./TwoFactorCard";

const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));

const off = { enabled: false, pendingEnrollment: false, recoveryCodesRemaining: 0, required: false };
const on = { enabled: true, pendingEnrollment: false, recoveryCodesRemaining: 10, required: false };

function adapter(overrides: Partial<TwoFactorAdapter> = {}): TwoFactorAdapter {
  return {
    getStatus: vi.fn().mockResolvedValue(off),
    start: vi.fn().mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP" }),
    confirm: vi.fn().mockResolvedValue({ recoveryCodes: ["AAAA-BBBB-CCCC-DDDD", "EEEE-FFFF-GGGG-HHHH"] }),
    disable: vi.fn().mockResolvedValue({ success: true }),
    regenerate: vi.fn().mockResolvedValue({ recoveryCodes: ["NEW1-NEW2-NEW3-NEW4"] }),
    ...overrides,
  };
}

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("TwoFactorCard", () => {
  it("enrols in two steps: password, then scan and confirm; shows recovery codes once", async () => {
    const a = adapter();
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<TwoFactorCard adapter={a} onChanged={onChanged} />);
    await user.click(await screen.findByRole("button", { name: "Set up" }));
    await user.type(screen.getByLabelText(/Confirm your password/), "my-password");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(a.start).toHaveBeenCalledWith("my-password"));

    expect(await screen.findByTestId("totp-secret")).toHaveTextContent("JBSWY3DPEHPK3PXP");
    await user.type(screen.getByLabelText("6 digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(a.confirm).toHaveBeenCalledWith("123456"));

    const list = await screen.findByTestId("recovery-codes");
    expect(list).toHaveTextContent("AAAA-BBBB-CCCC-DDDD");
    expect(onChanged).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "I have saved them" }));
    expect(screen.queryByTestId("recovery-codes")).not.toBeInTheDocument();
  });

  it("a wrong password or code is shown inline and keeps the form", async () => {
    const a = adapter({ start: vi.fn().mockRejectedValue(new Error("Current password is incorrect")) });
    const user = userEvent.setup();
    render(<TwoFactorCard adapter={a} />);
    await user.click(await screen.findByRole("button", { name: "Set up" }));
    await user.type(screen.getByLabelText(/Confirm your password/), "nope");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Current password is incorrect")).toBeInTheDocument();
  });

  it("turning off needs a code", async () => {
    const a = adapter({ getStatus: vi.fn().mockResolvedValue(on) });
    const user = userEvent.setup();
    render(<TwoFactorCard adapter={a} />);
    await user.click(await screen.findByRole("button", { name: "Turn off" }));
    await user.type(screen.getByLabelText(/Current 6 digit code/), "654321");
    await user.click(screen.getAllByRole("button", { name: "Turn off" })[0]);
    await waitFor(() => expect(a.disable).toHaveBeenCalledWith("654321"));
  });

  it("when two-factor is required there is no Turn off button", async () => {
    const a = adapter({ getStatus: vi.fn().mockResolvedValue({ ...on, required: true }) });
    render(<TwoFactorCard adapter={a} />);
    expect(await screen.findByText(/recovery codes? left/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn off" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New recovery codes" })).toBeInTheDocument();
  });

  it("regenerating sends the password and the code and shows the new codes", async () => {
    const a = adapter({ getStatus: vi.fn().mockResolvedValue(on) });
    const user = userEvent.setup();
    render(<TwoFactorCard adapter={a} />);
    await user.click(await screen.findByRole("button", { name: "New recovery codes" }));
    await user.type(screen.getByLabelText("Password"), "pw");
    await user.type(screen.getByLabelText(/Current 6 digit code/), "111222");
    await user.click(screen.getByRole("button", { name: "Generate new codes" }));
    await waitFor(() => expect(a.regenerate).toHaveBeenCalledWith("pw", "111222"));
    expect(await screen.findByTestId("recovery-codes")).toHaveTextContent("NEW1-NEW2-NEW3-NEW4");
  });
});
