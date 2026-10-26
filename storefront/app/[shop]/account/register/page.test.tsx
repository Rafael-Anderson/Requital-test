import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RegisterPage from "./page";

afterEach(cleanup);

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const register = vi.fn();
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ register }) }));

const shopState = vi.hoisted(() => ({ phoneOtpRequired: false }));
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({
    shopSlug: "test-shop",
    shopBasePath: "/test-shop",
    shop: { phoneOtpRequired: shopState.phoneOtpRequired },
  }),
}));

const api = vi.hoisted(() => ({ sendPhoneOtp: vi.fn(), verifyPhoneOtp: vi.fn() }));
vi.mock("@/lib/api", () => api);
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

async function fillDetails() {
  const user = userEvent.setup();
  const inputs = document.querySelectorAll("input");
  await user.type(inputs[0], "Jane");
  await user.type(inputs[1], "0501234567");
  await user.type(inputs[3], "long-enough-pw");
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  register.mockResolvedValue(undefined);
  api.sendPhoneOtp.mockResolvedValue(undefined);
});

describe("register page", () => {
  it("flag off: one step, no code calls, no proof sent", async () => {
    shopState.phoneOtpRequired = false;
    render(<RegisterPage />);
    const user = await fillDetails();
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(api.sendPhoneOtp).not.toHaveBeenCalled();
    expect(register.mock.calls[0][0].phoneProof).toBeUndefined();
  });

  it("flag on: sends a code, then verifies it and registers with the proof", async () => {
    shopState.phoneOtpRequired = true;
    api.verifyPhoneOtp.mockResolvedValue({ proof: "p".repeat(64) });
    render(<RegisterPage />);
    const user = await fillDetails();
    await user.click(screen.getByRole("button", { name: "Send verification code" }));
    const codeInput = await screen.findByLabelText("Verification code");
    expect(codeInput.getAttribute("autocomplete")).toBe("one-time-code");
    expect(register).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /Send a new code in/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(codeInput, "123456");
    await user.click(screen.getByRole("button", { name: "Verify and create account" }));
    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(api.verifyPhoneOtp).toHaveBeenCalledWith("test-shop", "0501234567", "123456");
    expect(register.mock.calls[0][0].phoneProof).toBe("p".repeat(64));
  });

  it("flag on: a wrong code shows a generic error and does not register", async () => {
    shopState.phoneOtpRequired = true;
    api.verifyPhoneOtp.mockRejectedValue(new Error("Invalid or expired code"));
    render(<RegisterPage />);
    const user = await fillDetails();
    await user.click(screen.getByRole("button", { name: "Send verification code" }));
    await user.type(await screen.findByLabelText("Verification code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify and create account" }));
    expect(await screen.findByText(/That code did not work/)).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
  });
});
