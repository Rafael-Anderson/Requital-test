import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "node:fs";
import path from "node:path";
import CollectionFormModal from "./CollectionFormModal";
import { ToastProvider } from "@/components/ui/Toast";
import { COLLECTION_SORT_OPTIONS } from "@/lib/collection-sort";
import type { Collection } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    createCollection: vi.fn(),
    updateCollection: vi.fn(),
    getCollection: vi.fn(),
    uploadCollectionImage: vi.fn(),
    previewCollectionRules: vi.fn().mockResolvedValue({ total: 0, page: 1, pageSize: 10, data: [] }),
  };
});
vi.mock("@/lib/useMetafieldEditor", () => ({
  useMetafieldEditor: () => ({ validate: () => null, save: async () => {} }),
}));
vi.mock("@/components/MetafieldsFields", () => ({ MetafieldsSection: () => null }));
import { createCollection, updateCollection } from "@/lib/api";

const base: Collection = {
  id: 4, name: "Roses", slug: "roses", displayOrder: 0, image: null, isFeatured: false,
  parentCollectionId: null, description: null, collectionType: "manual", matchMode: "all", defaultSort: null,
};

function open(collection: Collection | null) {
  return render(
    <ToastProvider>
      <CollectionFormModal collection={collection} collections={[base]} onClose={vi.fn()} onSaved={vi.fn()} />
    </ToastProvider>,
  );
}

describe("CollectionFormModal layout: header, scrollable body, footer in its own row", () => {
  it("the panel is about 90% of the viewport tall, and Cancel / Save sit OUTSIDE the scrolling body", () => {
    open(base);
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("h-[90vh]");
    expect(dialog.className).toContain("max-h-[90vh]");
    expect(dialog.className).toContain("flex-col");
    const body = dialog.querySelector(".modal-scroll") as HTMLElement;
    expect(body.className).toContain("overflow-y-auto");
    const save = screen.getByRole("button", { name: "Save changes" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(body.contains(save)).toBe(false);
    expect(body.contains(cancel)).toBe(false);
    expect(dialog.contains(save)).toBe(true);
  });

  it("nothing in the scrolling body is sticky (no footer can float over the fields)", () => {
    open(base);
    const body = screen.getByRole("dialog").querySelector(".modal-scroll") as HTMLElement;
    expect(body.querySelector(".sticky")).toBeNull();
    // the toggle and the type tabs live in the body, reachable by scrolling
    expect(within(body).getByText("Featured on homepage")).toBeInTheDocument();
    expect(within(body).getByRole("button", { name: "Automated" })).toBeInTheDocument();
  });

  it("Save still submits the form although it is outside it (form attribute)", async () => {
    const user = userEvent.setup();
    vi.mocked(updateCollection).mockResolvedValue(base);
    open(base);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateCollection).toHaveBeenCalled());
  });

  it("no sibling modal keeps the old sticky footer inside its scrolling body", () => {
    const dir = path.join(__dirname);
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/Modal\.tsx$/.test(e.name) && !p.endsWith(path.join("ui", "Modal.tsx"))) {
          const src = fs.readFileSync(p, "utf8");
          if (/sticky bottom-0/.test(src) && src.includes("<Modal")) offenders.push(path.relative(dir, p));
        }
      }
    };
    walk(dir);
    // ScanReceiveModal keeps its own bespoke footer (not a form; its Receive button is conditional)
    expect(offenders.sort()).toEqual(["ScanReceiveModal.tsx"]);
  });
});

describe("CollectionFormModal: default sort", () => {
  it("offers exactly the storefront sort options, with Newest as the default (NULL)", () => {
    open(null);
    const select = screen.getByLabelText("Default sort") as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toEqual(["", ...COLLECTION_SORT_OPTIONS.filter((o) => o.value !== "newest").map((o) => o.value)]);
    expect(select.options[0].textContent).toBe("Newest (default)");
    expect(select.value).toBe("");
    expect(COLLECTION_SORT_OPTIONS.map((o) => o.value)).toEqual(["best_selling", "newest", "oldest", "az", "za", "price_asc", "price_desc"]);
  });

  it("saves the chosen sort, and sends null when left on the default", async () => {
    const user = userEvent.setup();
    vi.mocked(createCollection).mockResolvedValue(base);
    open(null);
    await user.type(screen.getByLabelText("Name"), "Cheap first");
    await user.selectOptions(screen.getByLabelText("Default sort"), "price_asc");
    await user.click(screen.getByRole("button", { name: "Create collection" }));
    await waitFor(() => expect(createCollection).toHaveBeenCalled());
    expect(vi.mocked(createCollection).mock.calls.at(-1)![0].defaultSort).toBe("price_asc");

    cleanup();
    vi.mocked(createCollection).mockClear();
    open(null);
    await user.type(screen.getByLabelText("Name"), "Plain");
    await user.click(screen.getByRole("button", { name: "Create collection" }));
    await waitFor(() => expect(createCollection).toHaveBeenCalled());
    expect(vi.mocked(createCollection).mock.calls.at(-1)![0].defaultSort).toBeNull();
  });

  it("an edit loads the saved sort and can clear it back to the default", async () => {
    const user = userEvent.setup();
    vi.mocked(updateCollection).mockResolvedValue(base);
    open({ ...base, defaultSort: "best_selling" });
    const select = screen.getByLabelText("Default sort") as HTMLSelectElement;
    expect(select.value).toBe("best_selling");
    await user.selectOptions(select, "");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateCollection).toHaveBeenCalled());
    expect(vi.mocked(updateCollection).mock.calls.at(-1)![1].defaultSort).toBeNull();
  });
});
