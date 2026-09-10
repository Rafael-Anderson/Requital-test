import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AnnouncementBarChromeSettings from "./AnnouncementBarChromeSettings";

// Each message is now an inline rich-text editor (TipTap). Stub it with a
// labelled textarea so these tests stay about the list behaviour.
vi.mock("../RichTextBlockEditor", () => ({
  default: ({ label, value, onChange }: { label?: string; value: string; onChange: (v: string) => void }) => (
    <textarea aria-label={label ?? "Text"} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
  ),
}));

describe("AnnouncementBarChromeSettings", () => {
  it("shows only the enable toggle + hint when disabled", () => {
    render(<AnnouncementBarChromeSettings value={undefined} onChange={vi.fn()} />);
    expect(screen.getByRole("switch")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add message/i })).toBeNull();
  });

  it("enabling reveals the message editor and calls onChange with enabled:true", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AnnouncementBarChromeSettings value={{ enabled: false, messages: [] }} onChange={onChange} />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it("renders existing messages and an 'Add message' button when enabled", () => {
    render(
      <AnnouncementBarChromeSettings
        value={{ enabled: true, messages: ["Free delivery", "New arrivals"], dismissible: true }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Free delivery")).toBeInTheDocument();
    expect(screen.getByDisplayValue("New arrivals")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add message/i })).toBeInTheDocument();
    expect(screen.getByText("Rotation speed")).toBeInTheDocument();
  });
});
