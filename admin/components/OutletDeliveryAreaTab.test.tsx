import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OutletDeliveryAreaTab from "./OutletDeliveryAreaTab";
import { ToastProvider } from "@/components/ui/Toast";
import type { DeliveryZone, ZoneMappingProposal } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  listDeliveryZones: vi.fn(),
  getZoneMappingProposal: vi.fn(),
  getRegions: vi.fn(),
  setZoneMapping: vi.fn(),
  updateDeliveryZone: vi.fn(),
  deleteDeliveryZone: vi.fn(),
  createDeliveryZone: vi.fn(),
}));
vi.mock("@/lib/useShopCurrency", () => ({ useShopCurrency: () => "AED" }));
import { getRegions, getZoneMappingProposal, listDeliveryZones, setZoneMapping } from "@/lib/api";

afterEach(cleanup);

const uae = {
  country: { code: "AE", regionLabel: "Emirate" },
  regions: [
    { id: 1, code: "AE-AZ", nameEn: "Abu Dhabi", nameAr: "أبوظبي", sortOrder: 1 },
    { id: 2, code: "AE-DU", nameEn: "Dubai", nameAr: "دبي", sortOrder: 2 },
    { id: 3, code: "AE-SH", nameEn: "Sharjah", nameAr: "الشارقة", sortOrder: 3 },
  ],
};

function zone(id: number, name: string, extra: Partial<DeliveryZone> = {}): DeliveryZone {
  return {
    id,
    outletId: 7,
    name,
    fee: "15.00",
    minOrderAmount: "0.00",
    isActive: true,
    lat: null,
    lng: null,
    radiusKm: null,
    createdAt: "2026-09-30T00:00:00Z",
    regions: [],
    mappingConfirmedAt: null,
    ...extra,
  };
}

function proposalFor(zones: DeliveryZone[], mode: "legacy" | "regions" = "legacy"): ZoneMappingProposal {
  return {
    mode,
    unconfirmedActiveZones: zones.filter((z) => !z.mappingConfirmedAt && z.isActive).length,
    zones: zones.map((z) => ({
      zoneId: z.id,
      name: z.name,
      isActive: z.isActive,
      confirmed: !!z.mappingConfirmedAt,
      hasPlacedCircle: false,
      currentRegions: z.regions ?? [],
      current: `Currently matches only customers who type the area "${z.name}" exactly.`,
      proposal:
        z.name === "Dubai"
          ? { regionIds: [2], reason: "exact-name", confident: true, explanation: 'The zone name is exactly "Dubai".' }
          : z.name === "Dubai Full"
            ? {
                regionIds: [2],
                reason: "contains-name",
                confident: false,
                explanation: 'The zone name mentions "Dubai", but is not exactly that.',
              }
            : { regionIds: [], reason: "none", confident: false, explanation: "The zone name does not match any region." },
    })),
  };
}

function setup(zones: DeliveryZone[], mode: "legacy" | "regions" = "legacy", regions = uae) {
  vi.mocked(listDeliveryZones).mockResolvedValue(zones);
  vi.mocked(getZoneMappingProposal).mockResolvedValue(proposalFor(zones, mode));
  vi.mocked(getRegions).mockResolvedValue(regions as never);
  return render(
    <ToastProvider>
      <OutletDeliveryAreaTab outletId={7} />
    </ToastProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("OutletDeliveryAreaTab region mapping", () => {
  it("tells a shop still matching by name how many zones are left, and marks each one", async () => {
    setup([zone(1, "Dubai"), zone(2, "Sharjah", { mappingConfirmedAt: "2026-09-30T00:00:00Z", regions: [uae.regions[2]] })]);
    expect(await screen.findByText("Your delivery zones are still matched by name")).toBeInTheDocument();
    expect(screen.getByText(/1 left/)).toBeInTheDocument();
    expect(screen.getAllByText("Needs review")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Review" })).toBeInTheDocument();
  });

  it("shows no banner once the shop matches by region", async () => {
    setup([zone(1, "Dubai", { mappingConfirmedAt: "2026-09-30T00:00:00Z", regions: [uae.regions[1]] })], "regions");
    // The zone's name and its region chip both read "Dubai".
    await screen.findAllByText("Dubai");
    expect(screen.queryByText("Your delivery zones are still matched by name")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs review")).not.toBeInTheDocument();
  });

  it("pre-fills an exact-name proposal, and confirming sends exactly those regions", async () => {
    setup([zone(1, "Dubai")]);
    vi.mocked(setZoneMapping).mockResolvedValue(zone(1, "Dubai"));
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    expect(await screen.findByText("Suggested match")).toBeInTheDocument();
    expect(screen.getByText(/Currently matches only customers who type the area "Dubai"/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm emirates" }));
    await waitFor(() => expect(setZoneMapping).toHaveBeenCalledWith(7, 1, [2]));
  });

  it("an inexact proposal asks the merchant to check it, but still pre-fills it", async () => {
    setup([zone(1, "Dubai Full")]);
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    expect(await screen.findByText("Please check this one")).toBeInTheDocument();
    expect(screen.queryByText("Suggested match")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm emirates" })).toBeEnabled();
  });

  it("cannot confirm a zone with no region and no placed circle: it would match no customer", async () => {
    setup([zone(1, "Marina")]);
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    expect(await screen.findByRole("button", { name: "Confirm emirates" })).toBeDisabled();
    expect(screen.getByText(/Choose at least one emirate/)).toBeInTheDocument();
    expect(setZoneMapping).not.toHaveBeenCalled();
  });

  it("offers no review for a shop whose country has no regions", async () => {
    setup([zone(1, "Dubai")], "legacy", { country: null, regions: [] } as never);
    await screen.findByText("Dubai");
    expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
  });
});
