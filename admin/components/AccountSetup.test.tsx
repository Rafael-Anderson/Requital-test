import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountSetup from "./AccountSetup";
import { ToastProvider } from "@/components/ui/Toast";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const signupMock = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ signup: signupMock }),
}));

function renderWizard() {
  return render(
    <ToastProvider>
      <AccountSetup />
    </ToastProvider>,
  );
}

async function fillStep1(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("First Name"), "Jane");
  await user.type(screen.getByLabelText("Email"), "jane@example.com");
  await user.type(screen.getByLabelText("Phone Number"), "+971501234567");
  await user.type(screen.getByLabelText("Password"), "Password1!");
}

async function fillStep2(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Business Name"), "Jane's Flowers");
  await user.selectOptions(screen.getByLabelText("Business Type"), "Retail");
}

async function fillStep3(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Primary Location / Address"), "123 Main St, Dubai");
  await user.click(screen.getByLabelText("Online Only"));
  await user.selectOptions(screen.getByLabelText("Number of Branches"), "1");
}

async function advanceToReview(user: ReturnType<typeof userEvent.setup>) {
  await fillStep1(user);
  await user.click(screen.getByText("Next"));
  await waitFor(() => expect(screen.getByLabelText("Business Name")).toBeInTheDocument());
  await fillStep2(user);
  await user.click(screen.getByText("Next"));
  await waitFor(() => expect(screen.getByLabelText("Primary Location / Address")).toBeInTheDocument());
  await fillStep3(user);
  await user.click(screen.getByText("Next"));
  await waitFor(() => expect(screen.getByText("Create Account")).toBeInTheDocument());
}

beforeEach(() => {
  signupMock.mockReset();
  push.mockReset();
});

describe("AccountSetup wizard", () => {
  it("renders Step 1 (Personal Info) by default with no Back button", () => {
    renderWizard();
    expect(screen.getByLabelText("First Name")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.queryByText("Back")).not.toBeInTheDocument();
  });

  it("shows the blocking error modal when Next is pressed with empty required fields", async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByText("Next"));
    expect(screen.getByText("Fix these issues to continue")).toBeInTheDocument();
    expect(screen.getByText(/First Name: First name is required/)).toBeInTheDocument();
    expect(screen.getByText(/Email: Email is required/)).toBeInTheDocument();
  });

  it("shows an inline error on blur for an invalid email, and clears it once fixed", async () => {
    const user = userEvent.setup();
    renderWizard();
    const emailInput = screen.getByLabelText("Email");
    await user.type(emailInput, "not-an-email");
    await user.tab();
    expect(screen.getByText("Enter a valid email (e.g., name@example.com)")).toBeInTheDocument();

    await user.type(emailInput, "@example.com");
    await waitFor(() =>
      expect(screen.queryByText("Enter a valid email (e.g., name@example.com)")).not.toBeInTheDocument(),
    );
  });

  it("updates the password requirements checklist live as the user types", async () => {
    const user = userEvent.setup();
    renderWizard();
    const passwordInput = screen.getByLabelText("Password");
    expect(screen.getByText("At least 8 characters").className).toMatch(/text-zinc-400/);

    await user.type(passwordInput, "Password1!");
    await waitFor(() => expect(screen.getByText("At least 8 characters").className).toMatch(/text-green/));
    expect(screen.getByText("1 uppercase letter (A–Z)").className).toMatch(/text-green/);
    expect(screen.getByText("1 number (0–9)").className).toMatch(/text-green/);
    expect(screen.getByText("1 special character (@#$%^&*!?)").className).toMatch(/text-green/);
  });

  it("advances to Step 2 once Step 1 is valid, and Back returns to Step 1 with data intact", async () => {
    const user = userEvent.setup();
    renderWizard();
    await fillStep1(user);
    await user.click(screen.getByText("Next"));

    await waitFor(() => expect(screen.getByLabelText("Business Name")).toBeInTheDocument());

    await user.click(screen.getByText("Back"));
    expect(screen.getByLabelText("First Name")).toHaveValue("Jane");
  });

  it("treats TRN and Website URL as optional — blank does not block Step 2", async () => {
    const user = userEvent.setup();
    renderWizard();
    await fillStep1(user);
    await user.click(screen.getByText("Next"));
    await waitFor(() => expect(screen.getByLabelText("Business Name")).toBeInTheDocument());

    await fillStep2(user);
    await user.click(screen.getByText("Next"));
    await waitFor(() => expect(screen.getByLabelText("Primary Location / Address")).toBeInTheDocument());
  });

  it("blocks Step 3 when no Operating Model checkbox is selected", async () => {
    const user = userEvent.setup();
    renderWizard();
    await fillStep1(user);
    await user.click(screen.getByText("Next"));
    await waitFor(() => expect(screen.getByLabelText("Business Name")).toBeInTheDocument());
    await fillStep2(user);
    await user.click(screen.getByText("Next"));
    await waitFor(() => expect(screen.getByLabelText("Primary Location / Address")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Primary Location / Address"), "123 Main St");
    await user.selectOptions(screen.getByLabelText("Number of Branches"), "1");
    await user.click(screen.getByText("Next"));

    expect(screen.getByText("Fix these issues to continue")).toBeInTheDocument();
    expect(screen.getByText(/Operating Model: Select at least one option/)).toBeInTheDocument();
  });

  it("reaches the Review step with a summary of every entered field", async () => {
    const user = userEvent.setup();
    renderWizard();
    await advanceToReview(user);

    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    expect(screen.getByText("Jane's Flowers")).toBeInTheDocument();
    expect(screen.getByText("123 Main St, Dubai")).toBeInTheDocument();
    expect(screen.getByText("Online Only")).toBeInTheDocument();
  });

  it("shows the success modal and redirects to / on Enter App after a successful submit", async () => {
    const user = userEvent.setup();
    signupMock.mockResolvedValue({});
    renderWizard();
    await advanceToReview(user);

    await user.click(screen.getByText("Create Account"));

    await waitFor(() => expect(screen.getByText("Welcome, Jane!")).toBeInTheDocument());
    expect(signupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Jane",
        email: "jane@example.com",
        phone: "+971501234567",
        shopName: "Jane's Flowers",
        businessType: "Retail",
        address: "123 Main St, Dubai",
        operatingModel: ["online_only"],
        branchCount: "1",
        productEditorMode: "simple",
      }),
    );

    await user.click(screen.getByText("Enter App"));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("Review step defaults to Simple product editor mode, and selecting Advanced is included in the submit payload", async () => {
    const user = userEvent.setup();
    signupMock.mockResolvedValue({});
    renderWizard();
    await advanceToReview(user);

    const simpleCard = screen.getByText("Simple").closest("label")!;
    expect(simpleCard.querySelector("input")).toBeChecked();

    await user.click(screen.getByText("Advanced"));
    await user.click(screen.getByText("Create Account"));

    await waitFor(() =>
      expect(signupMock).toHaveBeenCalledWith(expect.objectContaining({ productEditorMode: "advanced" })),
    );
  });

  it("shows the error modal on a failed submit, and Back returns to Step 1", async () => {
    const user = userEvent.setup();
    signupMock.mockRejectedValue(new Error("Email already in use"));
    renderWizard();
    await advanceToReview(user);

    await user.click(screen.getByText("Create Account"));

    await waitFor(() => expect(screen.getByText("Unable to create account")).toBeInTheDocument());
    expect(screen.getByText("Email already in use")).toBeInTheDocument();

    // Two "Back" buttons are on screen at once here: the wizard's own Step 4
    // Back button, and the error modal's — the modal's is the later one in
    // DOM order (it's rendered as a sibling after the main wizard content).
    const backButtons = screen.getAllByText("Back");
    await user.click(backButtons[backButtons.length - 1]);
    await waitFor(() => expect(screen.getByLabelText("First Name")).toBeInTheDocument());
  });

  it("Try Again on the error modal stays on Step 4", async () => {
    const user = userEvent.setup();
    signupMock.mockRejectedValue(new Error("Email already in use"));
    renderWizard();
    await advanceToReview(user);

    await user.click(screen.getByText("Create Account"));
    await waitFor(() => expect(screen.getByText("Unable to create account")).toBeInTheDocument());

    await user.click(screen.getByText("Try Again"));
    await waitFor(() => expect(screen.queryByText("Unable to create account")).not.toBeInTheDocument());
    expect(screen.getByText("Create Account")).toBeInTheDocument();
  });
});
