import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./page";
import { ApiError } from "@/lib/api";

const login = vi.fn();

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ login }),
}));

function renderPage() {
  return render(<LoginPage />);
}

// expectedMessage defaults to the credential-error copy since that's what
// every pre-existing test in this file (all mocking a generic "Invalid
// credentials" Error) already expects to land on.
async function submitFailedLogin(expectedMessage = "Incorrect email or password.") {
  const user = userEvent.setup();
  renderPage();
  await user.type(screen.getByLabelText("Email"), "shop@example.com");
  await user.type(screen.getByLabelText("Password"), "wrong-password");
  await user.click(screen.getByRole("button", { name: /sign in/i }));
  await waitFor(() => expect(screen.getByText(expectedMessage)).toBeInTheDocument());
  return user;
}

describe("LoginPage — error state", () => {
  it("shows the inline error message below the password field on a failed submit", async () => {
    login.mockRejectedValueOnce(new Error("Invalid credentials"));
    await submitFailedLogin();

    // Message text is the fixed copy, not whatever the API happened to say.
    expect(screen.getByText("Incorrect email or password.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect email or password.");
  });

  it("applies the error border styling to both the email and password inputs", async () => {
    login.mockRejectedValueOnce(new Error("Invalid credentials"));
    await submitFailedLogin();

    const emailInput = screen.getByLabelText("Email");
    const passwordInput = screen.getByLabelText("Password");
    expect(emailInput.className).toContain("border-red-600");
    expect(passwordInput.className).toContain("border-2");
    expect(passwordInput.className).toContain("border-red-600");
    expect(emailInput).toHaveAttribute("aria-invalid", "true");
    expect(passwordInput).toHaveAttribute("aria-invalid", "true");
  });

  it("clears the error when the user starts typing in the email field", async () => {
    login.mockRejectedValueOnce(new Error("Invalid credentials"));
    const user = await submitFailedLogin();

    await user.type(screen.getByLabelText("Email"), "x");
    expect(screen.queryByText("Incorrect email or password.")).not.toBeInTheDocument();
  });

  it("clears the error when the user starts typing in the password field", async () => {
    login.mockRejectedValueOnce(new Error("Invalid credentials"));
    const user = await submitFailedLogin();

    await user.type(screen.getByLabelText("Password"), "x");
    expect(screen.queryByText("Incorrect email or password.")).not.toBeInTheDocument();
  });

  it("shows no error state before any submit attempt", () => {
    renderPage();
    expect(screen.queryByText("Incorrect email or password.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
  });
});

describe("LoginPage — error message by failure type", () => {
  it("401 → \"Incorrect email or password.\"", async () => {
    login.mockRejectedValueOnce(new ApiError("Unauthorized", 401));
    await submitFailedLogin("Incorrect email or password.");
  });

  it("429 → \"Too many attempts. Please wait a moment.\"", async () => {
    login.mockRejectedValueOnce(new ApiError("Too Many Requests", 429));
    await submitFailedLogin("Too many attempts. Please wait a moment.");
  });

  it("423 → \"Account locked. Please reset your password.\"", async () => {
    login.mockRejectedValueOnce(new ApiError("Account is locked", 423));
    await submitFailedLogin("Account locked. Please reset your password.");
  });

  it("any other error → \"Something went wrong. Please try again.\"", async () => {
    login.mockRejectedValueOnce(new ApiError("Internal error", 500));
    await submitFailedLogin("Something went wrong. Please try again.");
  });

  it("falls back to message-substring matching for a non-ApiError rejection", async () => {
    login.mockRejectedValueOnce(new Error("Too many login attempts, rate limited"));
    await submitFailedLogin("Too many attempts. Please wait a moment.");
  });
});
