import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SegmentBuilderModal from "./SegmentBuilderModal";
import { ToastProvider } from "@/components/ui/Toast";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({
  createCustomerSegment: vi.fn(),
  updateCustomerSegment: vi.fn(),
  previewCustomerSegment: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderModal = () =>
  render(
    <ToastProvider>
      <SegmentBuilderModal segment={null} tags={[]} onClose={vi.fn()} onSaved={vi.fn()} />
    </ToastProvider>,
  );

describe("SegmentBuilderModal", () => {
  it("cannot preview or save until the condition has a value and the segment a name", async () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Preview count" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save segment" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Value"), "3");
    expect(screen.getByRole("button", { name: "Preview count" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save segment" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Name"), "Repeat buyers");
    expect(screen.getByRole("button", { name: "Save segment" })).toBeEnabled();
  });

  it("sends typed values (a number is a number) and shows the preview count", async () => {
    vi.mocked(api.previewCustomerSegment).mockResolvedValue({ count: 7 });
    vi.mocked(api.createCustomerSegment).mockResolvedValue({} as never);
    renderModal();
    await userEvent.selectOptions(screen.getByLabelText("Condition"), "gte");
    await userEvent.type(screen.getByLabelText("Value"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Preview count" }));
    expect(api.previewCustomerSegment).toHaveBeenCalledWith({
      op: "and",
      rules: [{ field: "orderCount", cmp: "gte", value: 3 }],
    });
    expect(await screen.findByText("7 customers match")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Name"), "Repeat");
    await userEvent.click(screen.getByRole("button", { name: "Save segment" }));
    await waitFor(() => expect(api.createCustomerSegment).toHaveBeenCalled());
  });

  it("drops a stale count the moment the rules change", async () => {
    vi.mocked(api.previewCustomerSegment).mockResolvedValue({ count: 7 });
    renderModal();
    await userEvent.type(screen.getByLabelText("Value"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Preview count" }));
    await screen.findByText("7 customers match");
    await userEvent.type(screen.getByLabelText("Value"), "4");
    expect(screen.queryByText("7 customers match")).not.toBeInTheDocument();
  });
});
