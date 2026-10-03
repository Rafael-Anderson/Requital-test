import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CardList, CardListItem, CardListSkeleton } from "./CardList";

describe("CardList", () => {
  it("is shown below md only", () => {
    const { container } = render(<CardList>{null}</CardList>);
    expect((container.firstElementChild as HTMLElement).className).toContain("md:hidden");
  });

  it("makes the whole card a link when given an href", () => {
    render(
      <CardList>
        <CardListItem href="/products/1/edit" openLabel="Edit Rose">
          <span>Rose</span>
        </CardListItem>
      </CardList>,
    );
    expect(screen.getByRole("link", { name: "Edit Rose" })).toHaveAttribute("href", "/products/1/edit");
  });

  it("calls onOpen on tap, but not when the checkbox or actions are tapped", async () => {
    const onOpen = vi.fn();
    const onChange = vi.fn();
    const onAction = vi.fn();
    render(
      <CardList>
        <CardListItem
          onOpen={onOpen}
          openLabel="View order 7"
          select={{ checked: false, onChange, label: "Select order 7" }}
          actions={<button onClick={onAction}>More</button>}
        >
          <span>Order 7</span>
        </CardListItem>
      </CardList>,
    );
    await userEvent.click(screen.getByRole("button", { name: "View order 7" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByLabelText("Select order 7"));
    expect(onChange).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("renders a select-all row when asked", async () => {
    const onChange = vi.fn();
    render(
      <CardList selectAll={{ checked: false, onChange, label: "Select all things" }}>{null}</CardList>,
    );
    await userEvent.click(screen.getByLabelText("Select all things"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("skeleton is aria-busy, below md only, and drops the checkbox slot when not selectable", () => {
    const { container, rerender } = render(<CardListSkeleton rows={3} />);
    const ul = container.firstElementChild as HTMLElement;
    expect(ul).toHaveAttribute("aria-busy", "true");
    expect(ul.className).toContain("md:hidden");
    expect(ul.querySelectorAll("li")).toHaveLength(3);
    const withBox = ul.querySelectorAll(".size-4").length;
    rerender(<CardListSkeleton rows={3} selectable={false} />);
    expect(container.querySelectorAll(".size-4").length).toBeLessThan(withBox);
  });
});
