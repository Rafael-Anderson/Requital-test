import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import BuilderSettingsSearch from "./BuilderSettingsSearch";
import type { BuilderContext, SearchTarget } from "@/lib/theme-builder-registry";

type GoTo = (target: SearchTarget, settingLabel?: string) => void;

afterEach(cleanup);

const ctx: BuilderContext = { sectionsMode: true, sectionTypesPresent: new Set(["hero", "announcement_bar"]) };

function Harness({ goToSetting }: { goToSetting: GoTo }) {
  const [q, setQ] = useState("");
  return (
    <BuilderSettingsSearch
      editor={{ settingsSearchQuery: q, setSettingsSearchQuery: setQ, builderContext: ctx, goToSetting }}
    />
  );
}

describe("BuilderSettingsSearch", () => {
  it("searches the whole builder: a grouped list with the area as header and a one-line description", async () => {
    const user = userEvent.setup();
    render(<Harness goToSetting={vi.fn<GoTo>()} />);
    await user.type(screen.getByPlaceholderText("Search settings..."), "speed");
    const group = screen.getByRole("group", { name: "Announcement bar" });
    expect(group).toHaveTextContent("Speed");
    expect(group).toHaveTextContent("How fast the message scrolls");
  });

  it("finds a section-level setting from another tab (Hero > Content position)", async () => {
    const user = userEvent.setup();
    render(<Harness goToSetting={vi.fn<GoTo>()} />);
    await user.type(screen.getByPlaceholderText("Search settings..."), "content position");
    expect(screen.getByRole("group", { name: "Hero" })).toHaveTextContent("Content position");
  });

  it("never lists a Layout entry that does not apply to this shop", async () => {
    const user = userEvent.setup();
    render(<Harness goToSetting={vi.fn<GoTo>()} />);
    await user.type(screen.getByPlaceholderText("Search settings..."), "top bar");
    expect(screen.queryByText("Top bar layout")).not.toBeInTheDocument();
    expect(screen.getByText("No settings match")).toBeInTheDocument();
  });

  it("arrow keys move, Enter opens the setting (target + field label) and clears the box", async () => {
    const user = userEvent.setup();
    const goToSetting = vi.fn<GoTo>();
    render(<Harness goToSetting={goToSetting} />);
    const input = screen.getByPlaceholderText("Search settings...");
    await user.type(input, "speed");
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}{Enter}");
    expect(goToSetting).toHaveBeenCalledTimes(1);
    const [target, label] = goToSetting.mock.calls[0];
    expect(target).toBeTruthy();
    expect(typeof label === "string" || label === undefined).toBe(true);
    expect(input).toHaveValue("");
  });

  it("clicking a result opens it", async () => {
    const user = userEvent.setup();
    const goToSetting = vi.fn<GoTo>();
    render(<Harness goToSetting={goToSetting} />);
    await user.type(screen.getByPlaceholderText("Search settings..."), "content position");
    await user.click(screen.getByRole("option", { name: /Content position/ }));
    expect(goToSetting).toHaveBeenCalledWith({ mode: "sections", kind: "section", sectionType: "hero" }, "Content position");
  });

  it("Escape clears the query and closes the list; an unmatched query shows the empty state", async () => {
    const user = userEvent.setup();
    render(<Harness goToSetting={vi.fn<GoTo>()} />);
    const input = screen.getByPlaceholderText("Search settings...");
    await user.type(input, "qqqqzzzz");
    expect(screen.getByText("No settings match")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
