import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TaxClassFormModal from "./TaxClassFormModal";
import type { TaxClass } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  createTaxClass: vi.fn(),
  updateTaxClass: vi.fn(),
}));

const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => toast,
}));

import { createTaxClass, updateTaxClass } from "@/lib/api";

const DEFAULT_CLASS: TaxClass = {
  id: 1,
  shopId: 7,
  name: "Standard",
  rate: "5.00",
  type: "standard",
  isDefault: true,
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
};

describe("TaxClassFormModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a standard class with its rate", async () => {
    const user = userEvent.setup();
    vi.mocked(createTaxClass).mockResolvedValue(DEFAULT_CLASS);
    const onSaved = vi.fn();
    render(
      <TaxClassFormModal taxClass={null} onClose={vi.fn()} onSaved={onSaved} />,
    );

    await user.type(screen.getByLabelText("Name"), "VAT 5%");
    await user.clear(screen.getByLabelText("Rate (%)"));
    await user.type(screen.getByLabelText("Rate (%)"), "5");
    await user.click(screen.getByText("Create tax class"));

    await waitFor(() => {
      expect(createTaxClass).toHaveBeenCalledWith({
        name: "VAT 5%",
        type: "standard",
        rate: 5,
      });
    });
    expect(onSaved).toHaveBeenCalled();
  });

  // The rate input is hidden for the 0% treatments, and the submitted rate is
  // forced to 0 — the backend rejects anything else, so the form must not let a
  // stale typed value reach it.
  it("hides the rate for a zero-rated class and always submits 0", async () => {
    const user = userEvent.setup();
    vi.mocked(createTaxClass).mockResolvedValue({
      ...DEFAULT_CLASS,
      type: "zero",
      rate: "0.00",
    });
    render(
      <TaxClassFormModal taxClass={null} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    await user.clear(screen.getByLabelText("Rate (%)"));
    await user.type(screen.getByLabelText("Rate (%)"), "5");
    await user.selectOptions(screen.getByLabelText("Treatment"), "zero");

    expect(screen.queryByLabelText("Rate (%)")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "Basic food");
    await user.click(screen.getByText("Create tax class"));

    await waitFor(() => {
      expect(createTaxClass).toHaveBeenCalledWith({
        name: "Basic food",
        type: "zero",
        rate: 0,
      });
    });
  });

  it.each(["exempt", "out_of_scope"])(
    "treats %s as a 0%% class with no rate input",
    async (type) => {
      const user = userEvent.setup();
      render(
        <TaxClassFormModal taxClass={null} onClose={vi.fn()} onSaved={vi.fn()} />,
      );
      await user.selectOptions(screen.getByLabelText("Treatment"), type);
      expect(screen.queryByLabelText("Rate (%)")).not.toBeInTheDocument();
      expect(screen.getByText(/always 0%/)).toBeInTheDocument();
    },
  );

  // A shop with no default class has nothing for an unassigned product to fall
  // back to, so the backend refuses to clear the flag. The form does not offer
  // it rather than surfacing a 400.
  it("cannot un-default the current default class", () => {
    render(
      <TaxClassFormModal
        taxClass={DEFAULT_CLASS}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByText(/To move it, open another class/)).toBeInTheDocument();
  });

  it("never sends isDefault on an edit that did not change it", async () => {
    const user = userEvent.setup();
    vi.mocked(updateTaxClass).mockResolvedValue(DEFAULT_CLASS);
    render(
      <TaxClassFormModal
        taxClass={DEFAULT_CLASS}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Renamed");
    await user.click(screen.getByText("Save changes"));

    await waitFor(() => {
      expect(updateTaxClass).toHaveBeenCalledWith(1, {
        name: "Renamed",
        type: "standard",
        rate: 5,
      });
    });
  });

  it("surfaces a backend rejection instead of closing", async () => {
    const user = userEvent.setup();
    vi.mocked(createTaxClass).mockRejectedValue(
      new Error("A tax class with this name already exists"),
    );
    const onSaved = vi.fn();
    render(
      <TaxClassFormModal taxClass={null} onClose={vi.fn()} onSaved={onSaved} />,
    );
    await user.type(screen.getByLabelText("Name"), "Standard");
    await user.click(screen.getByText("Create tax class"));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        "A tax class with this name already exists",
        "error",
      );
    });
    expect(onSaved).not.toHaveBeenCalled();
  });
});
