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

  it("scrolling mode shows a Speed slider (px/s); changing it stores a number, 'Use default' stores null", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AnnouncementBarChromeSettings
        value={{ enabled: true, messages: ["Free delivery"], scrolling: true, marqueeSpeed: 80 }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("Speed")).toBeInTheDocument();
    expect(screen.queryByText("Rotation speed")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /use default \(40 px\/s\)/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ marqueeSpeed: null }));
  });

  it("no Speed slider when the bar is not scrolling", () => {
    render(
      <AnnouncementBarChromeSettings value={{ enabled: true, messages: ["a", "b"], scrolling: false }} onChange={vi.fn()} />,
    );
    expect(screen.queryByText("Speed")).not.toBeInTheDocument();
  });

  it("order is On/Off, then the text, then Speed directly under the text", () => {
    render(
      <AnnouncementBarChromeSettings
        value={{ enabled: true, messages: ["Free delivery"], scrolling: true }}
        onChange={vi.fn()}
      />,
    );
    const html = document.body.innerHTML;
    const onOff = html.indexOf("Announcement bar</span>");
    const text = html.indexOf('aria-label="Message 1"');
    const addMessage = html.indexOf("Add message");
    const speed = html.indexOf(">Speed<");
    const dismiss = html.indexOf("Dismissible");
    expect(onOff).toBeGreaterThan(-1);
    expect(onOff).toBeLessThan(text);
    expect(text).toBeLessThan(speed);
    expect(addMessage).toBeLessThan(speed);
    // nothing but the text (and its Add message button) sits between the text and Speed
    expect(speed).toBeLessThan(dismiss);
  });

  it("Off hides every other control and says the bar is not shown at all", () => {
    render(<AnnouncementBarChromeSettings value={{ enabled: false, messages: ["x"], managed: true }} onChange={vi.fn()} />);
    expect(screen.getByText(/not shown on your storefront at all/i)).toBeInTheDocument();
    expect(screen.queryByText("Speed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add message/i })).toBeNull();
  });

  it("the Above/Below position control lives here, not in the Header panel", async () => {
    const user = userEvent.setup();
    const onPositionChange = vi.fn();
    render(
      <AnnouncementBarChromeSettings
        value={{ enabled: true, messages: ["x"] }}
        onChange={vi.fn()}
        position="above"
        onPositionChange={onPositionChange}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Announcement bar position"), "below");
    expect(onPositionChange).toHaveBeenCalledWith("below");
  });
});
