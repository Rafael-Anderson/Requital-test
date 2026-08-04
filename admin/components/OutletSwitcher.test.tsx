import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OutletSwitcher from "./OutletSwitcher";

afterEach(cleanup);

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { role: "admin" } }),
}));

const outlets = [
  { id: 1, name: "Main Branch" },
  { id: 2, name: "Downtown" },
];
const setSelectedOutletId = vi.fn();
vi.mock("@/lib/outlet-context", () => ({
  useOutletFilter: () => ({
    outlets,
    selectedOutletId: null,
    setSelectedOutletId,
    loading: false,
  }),
}));

describe("OutletSwitcher", () => {
  it("renders as a Combobox, not a native select", () => {
    render(<OutletSwitcher />);
    expect(screen.getByRole("combobox")).toHaveTextContent("All branches");
    expect(document.querySelector("select")).not.toBeInTheDocument();
  });

  it("selecting a branch calls setSelectedOutletId with its id", async () => {
    const user = userEvent.setup();
    render(<OutletSwitcher />);

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Downtown" }));

    expect(setSelectedOutletId).toHaveBeenCalledWith(2);
  });
});
