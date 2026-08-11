import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountSetupStepBusiness from "./AccountSetupStepBusiness";
import { useAccountSetupForm } from "@/lib/useAccountSetupForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ signup: vi.fn() }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  updateShopDomain: vi.fn(),
}));

// Renders the real useAccountSetupForm hook (only its dependencies are
// mocked, above) so this exercises the actual wiring between the step
// component and the hook, not a hand-shaped fake of the form object.
function Harness() {
  const form = useAccountSetupForm();
  return <AccountSetupStepBusiness form={form} registerFieldRef={() => () => {}} />;
}

function renderStep() {
  return render(<Harness />);
}

describe("AccountSetupStepBusiness — domain picker", () => {
  it("defaults to the Subdomain tab with the .requital.io suffix visible", () => {
    renderStep();
    expect(screen.getByLabelText("Subdomain")).toBeInTheDocument();
    expect(screen.getByText(".requital.io")).toBeInTheDocument();
    expect(screen.queryByLabelText("Custom domain")).not.toBeInTheDocument();
  });

  it("auto-fills the subdomain slug from the business name", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.type(screen.getByLabelText("Business Name"), "Acme Flowers & Gifts");

    expect(screen.getByLabelText("Subdomain")).toHaveValue("acme-flowers-gifts");
  });

  it("stops auto-filling once the subdomain has been edited by hand", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.type(screen.getByLabelText("Business Name"), "Acme");
    await user.clear(screen.getByLabelText("Subdomain"));
    await user.type(screen.getByLabelText("Subdomain"), "my-custom-slug");
    await user.type(screen.getByLabelText("Business Name"), " Flowers");

    expect(screen.getByLabelText("Subdomain")).toHaveValue("my-custom-slug");
  });

  it("switching to the Custom domain tab shows a plain domain input instead", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole("button", { name: "Custom domain" }));

    expect(screen.getByLabelText("Custom domain")).toBeInTheDocument();
    expect(screen.queryByLabelText("Subdomain")).not.toBeInTheDocument();
  });

  it("the how-to-connect info section starts collapsed and toggles open on click", async () => {
    const user = userEvent.setup();
    renderStep();
    await user.click(screen.getByRole("button", { name: "Custom domain" }));

    expect(screen.queryByText(/Log in to your domain registrar/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /How to connect your domain/ }));
    expect(screen.getByText(/Log in to your domain registrar/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /How to connect your domain/ }));
    expect(screen.queryByText(/Log in to your domain registrar/)).not.toBeInTheDocument();
  });
});
