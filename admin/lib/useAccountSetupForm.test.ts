import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAccountSetupForm } from "./useAccountSetupForm";

const signup = vi.fn();
const updateShopDomain = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ signup }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  updateShopDomain: (...args: unknown[]) => updateShopDomain(...args),
}));

// Fills every required field across steps 0-2 so handleSubmit's validateAll()
// passes, leaving only the domain-picker fields (step 1) for each test to
// set up itself.
function fillRequiredFields(form: ReturnType<typeof useAccountSetupForm>) {
  form.firstNameHandlers.onChange("Jane");
  form.emailHandlers.onChange("jane@example.com");
  form.phoneHandlers.onChange("+971501234567");
  form.passwordHandlers.onChange("Password1!");
  form.businessNameHandlers.onChange("Acme Flowers");
  form.setBusinessType("Retail");
  form.addressHandlers.onChange("123 Main St");
  form.setOperatingModel("online_only");
  form.setBranchCount("1");
}

beforeEach(() => {
  signup.mockReset();
  updateShopDomain.mockReset();
  signup.mockResolvedValue({ user: { shopId: 1 } });
  updateShopDomain.mockResolvedValue({});
});

describe("useAccountSetupForm — domain submission", () => {
  it("subdomain path: signs up with the auto-filled slug and never calls updateShopDomain", async () => {
    const { result } = renderHook(() => useAccountSetupForm());
    act(() => fillRequiredFields(result.current));

    let outcome: { ok: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.handleSubmit();
    });

    expect(outcome?.ok).toBe(true);
    expect(signup).toHaveBeenCalledWith(expect.objectContaining({ subdomain: "acme-flowers" }));
    expect(updateShopDomain).not.toHaveBeenCalled();
  });

  it("custom domain path: signs up (still with a subdomain slug), then connects the custom domain", async () => {
    const { result } = renderHook(() => useAccountSetupForm());
    act(() => {
      fillRequiredFields(result.current);
      result.current.setDomainType("custom");
    });
    act(() => {
      result.current.customDomainHandlers.onChange("Shop.Example.com");
      result.current.customDomainHandlers.onBlur("Shop.Example.com");
    });

    let outcome: { ok: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.handleSubmit();
    });

    expect(outcome?.ok).toBe(true);
    expect(signup).toHaveBeenCalledWith(expect.objectContaining({ subdomain: "acme-flowers" }));
    expect(updateShopDomain).toHaveBeenCalledWith({
      type: "custom",
      customDomain: "shop.example.com",
    });
  });

  it("custom domain path: a failed domain connect still reports the overall submit as successful", async () => {
    updateShopDomain.mockRejectedValue(new Error("409"));
    const { result } = renderHook(() => useAccountSetupForm());
    act(() => {
      fillRequiredFields(result.current);
      result.current.setDomainType("custom");
    });
    act(() => result.current.customDomainHandlers.onChange("shop.example.com"));

    let outcome: { ok: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.handleSubmit();
    });

    expect(outcome?.ok).toBe(true);
  });
});
