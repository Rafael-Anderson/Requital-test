import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ThemeLibraryPage from "./page";
import { ToastProvider } from "@/components/ui/Toast";
import { getTheme, listThemes, listThemeTemplates, createTheme, resolveImageUrl } from "@/lib/api";
import type { ThemeTemplateMeta } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getTheme: vi.fn(),
  listThemes: vi.fn(),
  listThemeTemplates: vi.fn(),
  createTheme: vi.fn(),
  deleteTheme: vi.fn(),
  resolveImageUrl: vi.fn(() => null),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const templates: ThemeTemplateMeta[] = [
  { key: "atelier", name: "Atelier", blurb: "Quiet editorial luxury.", previewColors: { bg: "#FBFAF7", text: "#1A1A17", button: "#5A6B54" } },
  { key: "market", name: "Market", blurb: "Dense and warm.", previewColors: { bg: "#FFFFFF", text: "#232323", button: "#E24A6A" } },
  { key: "bloom", name: "Bloom", blurb: "Playful gifting.", previewColors: { bg: "#FFFFFF", text: "#221B3A", button: "#7C5CFF" } },
  { key: "heritage", name: "Heritage", blurb: "Classic and structured.", previewColors: { bg: "#F6F3EC", text: "#2B2B2B", button: "#B08D3F" } },
];

function renderPage() {
  return render(
    <ToastProvider>
      <ThemeLibraryPage />
    </ToastProvider>,
  );
}

describe("ThemeLibraryPage — template picker (G0)", () => {
  it("renders a card for each starter template", async () => {
    vi.mocked(getTheme).mockResolvedValue({ brandColor: "#069494" } as never);
    vi.mocked(listThemes).mockResolvedValue([] as never);
    vi.mocked(listThemeTemplates).mockResolvedValue(templates as never);
    vi.mocked(resolveImageUrl).mockReturnValue(null);

    renderPage();

    await waitFor(() => expect(screen.getByText("Start from a template")).toBeInTheDocument());
    for (const t of templates) {
      expect(screen.getByText(t.name)).toBeInTheDocument();
      expect(screen.getByText(t.blurb)).toBeInTheDocument();
    }
  });

  it("clicking a template card creates a theme with fromTemplate and opens the builder", async () => {
    const user = userEvent.setup();
    vi.mocked(getTheme).mockResolvedValue({ brandColor: "#069494" } as never);
    vi.mocked(listThemes).mockResolvedValue([] as never);
    vi.mocked(listThemeTemplates).mockResolvedValue(templates as never);
    vi.mocked(createTheme).mockResolvedValue({ id: 123 } as never);

    renderPage();
    await waitFor(() => expect(screen.getByText("Heritage")).toBeInTheDocument());

    await user.click(screen.getByText("Heritage"));

    expect(createTheme).toHaveBeenCalledWith({ name: "Heritage", fromTemplate: "heritage" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/theme/123/builder"));
  });

  it("hides the template section entirely when none load", async () => {
    vi.mocked(getTheme).mockResolvedValue({ brandColor: "#069494" } as never);
    vi.mocked(listThemes).mockResolvedValue([] as never);
    vi.mocked(listThemeTemplates).mockResolvedValue([] as never);

    renderPage();
    await waitFor(() => expect(screen.getByText("Custom themes")).toBeInTheDocument());
    expect(screen.queryByText("Start from a template")).not.toBeInTheDocument();
  });
});
