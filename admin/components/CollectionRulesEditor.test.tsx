import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const previewMock = vi.fn();
vi.mock("@/lib/api", () => ({
  previewCollectionRules: (...args: unknown[]) => previewMock(...args),
  resolveImageUrl: (u: string) => u,
}));

import CollectionRulesEditor from "./CollectionRulesEditor";
import type { CollectionRule } from "@/lib/types";
import { useState } from "react";

function Harness({ initial }: { initial: CollectionRule[] }) {
  const [rules, setRules] = useState(initial);
  const [mode, setMode] = useState<"all" | "any">("all");
  return (
    <CollectionRulesEditor
      matchMode={mode}
      onMatchModeChange={setMode}
      rules={rules}
      onRulesChange={setRules}
      manualCollections={[]}
    />
  );
}

describe("CollectionRulesEditor", () => {
  beforeEach(() => {
    previewMock.mockReset();
    previewMock.mockResolvedValue({ total: 3, page: 1, pageSize: 10, data: [] });
  });

  it("shows the live match count for complete conditions", async () => {
    render(<Harness initial={[{ field: "title", operator: "contains", value: "rose" }]} />);
    await waitFor(() => expect(screen.getByText("3 products match")).toBeInTheDocument());
    expect(previewMock).toHaveBeenCalledWith(
      expect.objectContaining({ matchMode: "all", rules: [{ field: "title", operator: "contains", value: "rose" }] }),
    );
  });

  it("does not call the server for an incomplete condition", async () => {
    render(<Harness initial={[{ field: "title", operator: "contains", value: "" }]} />);
    expect(screen.getByText("Finish the conditions to see matching products.")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 450));
    expect(previewMock).not.toHaveBeenCalled();
  });

  it("Add condition appends a row and switching to any re-queries", async () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /add condition/i }));
    expect(screen.getByLabelText("Condition 1 operator")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("any condition"));
    expect((screen.getByLabelText("any condition") as HTMLInputElement).checked).toBe(true);
  });
});
