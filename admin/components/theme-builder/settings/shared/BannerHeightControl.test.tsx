import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import BannerHeightControl from "./BannerHeightControl";
import { clampBannerHeight } from "@/lib/banner-height";

afterEach(cleanup);

describe("BannerHeightControl", () => {
  it("starts on the default and sets a custom height from it", () => {
    const onChange = vi.fn();
    render(
      <BannerHeightControl desktop={undefined} mobile={undefined} defaultHeight={220} defaultNote="Currently 220px." onChange={onChange} />,
    );
    expect(screen.getByText("Currently 220px.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set a custom height" }));
    expect(onChange).toHaveBeenCalledWith({ desktop: 220, mobile: undefined });
  });

  it("edits desktop and mobile separately and clamps to 120..900", () => {
    const onChange = vi.fn();
    render(
      <BannerHeightControl desktop={400} mobile={undefined} defaultHeight={220} defaultNote="" onChange={onChange} />,
    );
    const [desktop, mobile] = screen.getAllByRole("spinbutton");
    fireEvent.change(desktop, { target: { value: "5000" } });
    expect(onChange).toHaveBeenLastCalledWith({ desktop: 900, mobile: undefined });
    fireEvent.change(mobile, { target: { value: "10" } });
    expect(onChange).toHaveBeenLastCalledWith({ desktop: 400, mobile: 120 });
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(onChange).toHaveBeenLastCalledWith({ desktop: undefined, mobile: undefined });
    expect(clampBannerHeight(NaN)).toBe(120);
  });

  it("never offers a width control", () => {
    render(<BannerHeightControl desktop={400} mobile={300} defaultHeight={220} defaultNote="" onChange={() => {}} />);
    expect(screen.queryByText(/width/i, { selector: "label" })).toBeNull();
  });
});
