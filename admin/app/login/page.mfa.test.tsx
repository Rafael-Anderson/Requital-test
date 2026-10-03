import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./page";
import { ApiError } from "@/lib/api";

const login = vi.fn();
const completeMfa = vi.fn();
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ login, completeMfa }) }));

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

async function passwordStep() {
  const user = userEvent.setup();
  render(<LoginPage />);
  await user.type(screen.getByLabelText("Email"), "a@b.com");
  await user.type(screen.getByLabelText("Password"), "pw-123456");
  await user.click(screen.getByRole("button", { name: /sign in/i }));
  return user;
}

describe("LoginPage second factor step", () => {
  it("a correct password with two-factor on shows the code step instead of signing in", async () => {
    login.mockResolvedValueOnce({ mfaToken: "pending-token" });
    await passwordStep();
    expect(await screen.findByLabelText("Authentication code")).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("submits the pending token with the code, trimmed", async () => {
    login.mockResolvedValueOnce({ mfaToken: "pending-token" });
    completeMfa.mockResolvedValueOnce(undefined);
    const user = await passwordStep();
    await user.type(await screen.findByLabelText("Authentication code"), " 123456 ");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(completeMfa).toHaveBeenCalledWith("pending-token", "123456"));
  });

  it("a wrong code keeps the step and says so; Back returns to the password form", async () => {
    login.mockResolvedValueOnce({ mfaToken: "pending-token" });
    completeMfa.mockRejectedValueOnce(new ApiError("That code is not valid.", 401, "mfa_invalid"));
    const user = await passwordStep();
    await user.type(await screen.findByLabelText("Authentication code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("That code is not valid.")).toBeInTheDocument();
    expect(screen.getByLabelText("Authentication code")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("a locked account shows the server message, not the generic rate-limit one", async () => {
    login.mockResolvedValueOnce({ mfaToken: "pending-token" });
    completeMfa.mockRejectedValueOnce(
      new ApiError("Too many incorrect codes. Try again in 15 minutes.", 429, "mfa_locked"),
    );
    const user = await passwordStep();
    await user.type(await screen.findByLabelText("Authentication code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText(/Try again in 15 minutes/)).toBeInTheDocument();
  });

  it("an expired pending token sends the user back to the password step", async () => {
    login.mockResolvedValueOnce({ mfaToken: "pending-token" });
    completeMfa.mockRejectedValueOnce(new ApiError("Your sign-in expired. Start again.", 401));
    const user = await passwordStep();
    await user.type(await screen.findByLabelText("Authentication code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(screen.getByLabelText("Password")).toBeInTheDocument());
  });
});
