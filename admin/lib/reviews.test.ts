import { describe, expect, it } from "vitest";
import { consentLabel, disabledReason } from "./reviews";

describe("review consent copy", () => {
  it("labels each consent state, NULL as unknown", () => {
    expect(consentLabel(1)).toBe("Agreed to publish");
    expect(consentLabel(0)).toBe("Did not agree to publish");
    expect(consentLabel(null)).toBe("No consent recorded");
  });
  it("explains why the switch is disabled", () => {
    expect(disabledReason({ publishConsent: 1, canFeature: true })).toBeNull();
    expect(disabledReason({ publishConsent: null, canFeature: false })).toMatch(/did not agree/);
    expect(disabledReason({ publishConsent: 0, canFeature: false })).toMatch(/did not agree/);
    expect(disabledReason({ publishConsent: 1, canFeature: false })).toMatch(/no written comment/);
  });
});
