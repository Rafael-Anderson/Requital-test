import { describe, expect, it } from "vitest";
import {
  buildCreatePayload,
  buildUpdatePayload,
  channelStateLabel,
  connectionStatus,
  deadlineState,
  enableBlockedReason,
  formatRemaining,
  isMarketplaceChannel,
  providerLabel,
  verificationView,
  type ConnectionFormValues,
} from "./channels";
import type { ChannelConnection, ChannelProviderInfo } from "./types";

const provider = (over: Partial<ChannelProviderInfo["capabilities"]> = {}): ChannelProviderInfo => ({
  name: "deliveroo",
  displayName: "Deliveroo",
  credentialFields: [
    { key: "clientId", label: "Client ID" },
    { key: "clientSecret", label: "Client secret" },
  ],
  capabilities: { acceptReject: true, platformWebhookSecret: false, provesLocationOwnership: false, ...over },
});

const conn = (over: Partial<ChannelConnection> = {}): ChannelConnection => ({
  id: 1,
  outletId: 5,
  provider: "deliveroo",
  externalLocationId: "LOC-1",
  externalBrandId: null,
  externalSiteId: null,
  hasCredentials: true,
  hasWebhookSecret: true,
  enabled: false,
  lastSyncAt: null,
  lastSyncStatus: null,
  lastError: null,
  locationVerified: true,
  verificationRequestedAt: null,
  autoConfirmScheduled: false,
  createdAt: "2026-10-13T00:00:00.000Z",
  ...over,
});

const FIELDS = [{ key: "clientId" }, { key: "clientSecret" }];
const form = (over: Partial<ConnectionFormValues> = {}): ConnectionFormValues => ({
  outletId: 5,
  provider: "deliveroo",
  externalLocationId: "LOC-1",
  externalBrandId: "",
  externalSiteId: "",
  credentials: {},
  webhookSecret: "",
  ...over,
});

describe("labels", () => {
  it("never shows a raw enum", () => {
    expect(channelStateLabel("pending_acceptance")).toBe("Waiting for you to accept");
    expect(channelStateLabel("cancelled_upstream")).toBe("Cancelled by the marketplace");
    expect(channelStateLabel("needs_mapping")).toBe("Needs item mapping");
    expect(channelStateLabel("zzz")).toBe("Unknown status");
    expect(providerLabel("deliveroo")).toBe("Deliveroo");
    expect(providerLabel("some_new_market")).toBe("Some new market");
  });

  it("recognises marketplace channels only", () => {
    expect(isMarketplaceChannel("deliveroo")).toBe(true);
    expect(isMarketplaceChannel("talabat")).toBe(true);
    // exact match, like the backend: hand-typed spellings are ordinary orders
    expect(isMarketplaceChannel("Talabat")).toBe(false);
    expect(isMarketplaceChannel(" deliveroo ")).toBe(false);
    expect(isMarketplaceChannel("toString")).toBe(false);
    expect(isMarketplaceChannel("storefront")).toBe(false);
    expect(isMarketplaceChannel(null)).toBe(false);
  });
});

describe("deadlineState", () => {
  const now = Date.parse("2026-10-13T10:00:00Z");
  it("counts down, turns urgent under two minutes and reports a passed window", () => {
    expect(deadlineState("2026-10-13T10:05:00Z", now)).toEqual({ kind: "open", text: "Accept within 5 min 00 s" });
    expect(deadlineState("2026-10-13T10:01:30Z", now).kind).toBe("urgent");
    expect(deadlineState("2026-10-13T09:59:00Z", now).kind).toBe("passed");
    expect(deadlineState("2026-10-13T09:59:00Z", now).text).toContain("may already have rejected");
  });
  it("says so when the marketplace sent no deadline, and never invents one", () => {
    expect(deadlineState(null, now).kind).toBe("none");
    expect(deadlineState("not a date", now).kind).toBe("none");
  });
  it("formats long waits in hours", () => {
    expect(formatRemaining(90 * 60_000)).toBe("1 h 30 min");
    expect(formatRemaining(45_000)).toBe("45 s");
  });
});

describe("enableBlockedReason", () => {
  it("is null when everything is in place", () => {
    expect(enableBlockedReason(conn(), provider(), true)).toBeNull();
  });
  it("explains each missing piece in words, in a fixed order", () => {
    expect(enableBlockedReason(conn(), provider(), false)).toMatch(/not available for your shop/);
    expect(enableBlockedReason(conn({ externalLocationId: null }), provider(), true)).toBe("Add the location ID first.");
    expect(enableBlockedReason(conn({ hasCredentials: false }), provider(), true)).toBe("Add the marketplace credentials first.");
    expect(enableBlockedReason(conn({ hasWebhookSecret: false }), provider(), true)).toBe("Add the webhook secret first.");
    expect(enableBlockedReason(conn({ locationVerified: false }), provider(), true)).toBe(
      "Waiting for Requital to verify your location with the marketplace.",
    );
  });
  it("does not need a webhook secret when the platform holds it, nor staff verification when the provider proves the location", () => {
    expect(enableBlockedReason(conn({ hasWebhookSecret: false }), provider({ platformWebhookSecret: true }), true)).toBeNull();
    expect(enableBlockedReason(conn({ locationVerified: false }), provider({ provesLocationOwnership: true }), true)).toBeNull();
  });
  it("never blocks turning a live connection OFF", () => {
    expect(enableBlockedReason(conn({ enabled: true, locationVerified: false }), provider(), false)).toBeNull();
  });
});

describe("verification and status", () => {
  it("distinguishes verified, waiting and automatic", () => {
    expect(verificationView(conn(), provider())).toBe("verified");
    expect(verificationView(conn({ locationVerified: false }), provider())).toBe("waiting");
    expect(verificationView(conn({ locationVerified: false }), provider({ provesLocationOwnership: true }))).toBe("automatic");
  });
  it("derives one status word", () => {
    expect(connectionStatus(conn({ enabled: true }), provider())).toBe("live");
    expect(connectionStatus(conn({ locationVerified: false }), provider())).toBe("waiting_verification");
    expect(connectionStatus(conn({ hasCredentials: false }), provider())).toBe("needs_setup");
    expect(connectionStatus(conn(), provider())).toBe("off");
  });
});

describe("payloads: a secret is sent only when the user typed it", () => {
  it("create without any typed secret carries no credentials and no webhook secret", () => {
    const p = buildCreatePayload(form(), FIELDS);
    expect(p).toEqual({ outletId: 5, provider: "deliveroo", externalLocationId: "LOC-1" });
    expect(JSON.stringify(p)).not.toMatch(/credentials|webhookSecret/);
  });
  it("create with every credential typed sends the map; a partial set is refused", () => {
    expect(buildCreatePayload(form({ credentials: { clientId: "id", clientSecret: "s3cret" }, webhookSecret: "whsec-123456" }), FIELDS)).toMatchObject({
      credentials: { clientId: "id", clientSecret: "s3cret" },
      webhookSecret: "whsec-123456",
    });
    expect(buildCreatePayload(form({ credentials: { clientId: "id" } }), FIELDS)).toHaveProperty("error");
  });
  it("create sends no empty ids and trims the ones given", () => {
    expect(buildCreatePayload(form({ externalLocationId: "  LOC-9 ", externalBrandId: "  " }), FIELDS)).toEqual({
      outletId: 5,
      provider: "deliveroo",
      externalLocationId: "LOC-9",
    });
  });
  it("update with nothing typed and nothing changed is an empty payload", () => {
    expect(buildUpdatePayload(conn(), form(), FIELDS)).toEqual({});
  });
  it("update sends only the id that changed, and null to clear one", () => {
    expect(buildUpdatePayload(conn(), form({ externalLocationId: "LOC-2" }), FIELDS)).toEqual({ externalLocationId: "LOC-2" });
    expect(buildUpdatePayload(conn({ externalBrandId: "B1" }), form({ externalBrandId: "" }), FIELDS)).toEqual({ externalBrandId: null });
  });
  it("update replaces credentials only as a whole set, and the webhook secret only when typed", () => {
    expect(buildUpdatePayload(conn(), form({ credentials: { clientId: "only-one" } }), FIELDS)).toHaveProperty("error");
    expect(buildUpdatePayload(conn(), form({ webhookSecret: "new-secret-1" }), FIELDS)).toEqual({ webhookSecret: "new-secret-1" });
    expect(buildUpdatePayload(conn(), form({ credentials: { clientId: "a", clientSecret: "b" } }), FIELDS)).toEqual({
      credentials: { clientId: "a", clientSecret: "b" },
    });
  });
});
