import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/Toast";
import RedirectsPage from "./page";

afterEach(cleanup);

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listUrlRedirects: vi.fn(),
    listNotFoundLog: vi.fn(),
    createUrlRedirect: vi.fn(),
    updateUrlRedirect: vi.fn(),
    deleteUrlRedirect: vi.fn(),
    dismissNotFoundEntry: vi.fn(),
    clearNotFoundLog: vi.fn(),
    previewUrlRedirectImport: vi.fn(),
    confirmUrlRedirectImport: vi.fn(),
  };
});
import { createUrlRedirect, listNotFoundLog, listUrlRedirects } from "@/lib/api";

const ROW = {
  id: 1,
  fromPath: "/old-page",
  toTarget: "/new-page",
  statusCode: 301 as const,
  active: true,
  hitCount: 7,
  lastHitAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.mocked(listUrlRedirects).mockResolvedValue({ data: [ROW], page: 1, pageSize: 25, total: 1, limit: 10000 });
  vi.mocked(listNotFoundLog).mockResolvedValue({
    data: [
      {
        id: 9,
        path: "/missing/thing",
        hitCount: 12,
        firstSeenAt: "2026-10-01T00:00:00.000Z",
        lastSeenAt: "2026-10-02T00:00:00.000Z",
        lastReferrer: "google.com",
        hasRedirect: false,
      },
    ],
    page: 1,
    pageSize: 25,
    total: 1,
  });
  vi.mocked(createUrlRedirect).mockResolvedValue(ROW);
});

function renderPage() {
  return render(
    <ToastProvider>
      <RedirectsPage />
    </ToastProvider>,
  );
}

describe("Redirects settings page", () => {
  it("lists redirects with their visit counts", async () => {
    renderPage();
    // jsdom applies no CSS, so both the phone card list and the table are in the DOM; these address the table.
    await screen.findAllByText("/old-page");
    const table = within(screen.getByRole("table"));
    expect(table.getByText("/old-page")).toBeTruthy();
    expect(table.getByText("/new-page")).toBeTruthy();
    expect(table.getByText("7")).toBeTruthy();
  });

  it("the 404 report row opens the redirect form pre-filled with that path", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("/old-page");
    await user.click(screen.getByRole("button", { name: "404 report" }));
    await screen.findAllByText("/missing/thing");
    const table = within(screen.getByRole("table"));
    expect(table.getByText("google.com")).toBeTruthy();
    await user.click(table.getByRole("button", { name: "Create redirect from /missing/thing" }));
    const from = (await screen.findByLabelText("Old URL path")) as HTMLInputElement;
    expect(from.value).toBe("/missing/thing");
    await user.type(screen.getByLabelText("Send visitors to"), "/products/new");
    await user.click(screen.getByRole("button", { name: "Create redirect" }));
    await waitFor(() =>
      expect(createUrlRedirect).toHaveBeenCalledWith({
        fromPath: "/missing/thing",
        toTarget: "/products/new",
        statusCode: 301,
        active: true,
      }),
    );
  });

  it("shows the server's validation message inside the form instead of closing it", async () => {
    vi.mocked(createUrlRedirect).mockRejectedValueOnce(new Error("Target must not start with // (that would leave the site)"));
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("/old-page");
    await user.click(screen.getByRole("button", { name: /Add redirect/ }));
    await user.type(await screen.findByLabelText("Old URL path"), "/a");
    await user.type(screen.getByLabelText("Send visitors to"), "//evil.com");
    await user.click(screen.getByRole("button", { name: "Create redirect" }));
    expect(await screen.findByText(/would leave the site/)).toBeTruthy();
    expect(screen.getByLabelText("Old URL path")).toBeTruthy();
  });
});
