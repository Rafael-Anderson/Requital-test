import type {
  ChannelConnection,
  ChannelConnectionInput,
  ChannelConnectionUpdate,
  ChannelOrderState,
  ChannelProviderInfo,
} from "./types";

// Marketplace names as a merchant reads them. A provider not listed falls back
// to a tidied version of its own name, never to a raw enum.
const PROVIDER_LABELS: Record<string, string> = {
  deliveroo: "Deliveroo",
  talabat: "Talabat",
  stub_marketplace: "Test marketplace",
};

export function providerLabel(name: string | null | undefined, info?: ChannelProviderInfo[]): string {
  if (!name) return "";
  const declared = info?.find((p) => p.name === name)?.displayName;
  if (declared && declared !== name) return declared;
  return PROVIDER_LABELS[name] ?? name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

// `order.channel` carries the marketplace name for a marketplace order (and
// 'storefront' or free text otherwise). Only these are drawn as a source badge.
export function isMarketplaceChannel(channel: string | null | undefined): boolean {
  return !!channel && Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, channel.trim().toLowerCase());
}

export const CHANNEL_STATE_LABELS: Record<ChannelOrderState, string> = {
  needs_mapping: "Needs item mapping",
  pending_acceptance: "Waiting for you to accept",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled_upstream: "Cancelled by the marketplace",
};

export const CHANNEL_STATE_HINTS: Record<ChannelOrderState, string> = {
  needs_mapping:
    "Some items are not linked to your products yet. Link them in Sales channels and the order moves on by itself. Nothing is created for you.",
  pending_acceptance: "The marketplace is holding this order until you accept or reject it.",
  accepted: "You accepted this order. Prepare it like any other order.",
  rejected: "This order was rejected and any held stock was released.",
  cancelled_upstream: "The marketplace cancelled this order. Any held stock was released.",
};

export function channelStateLabel(state: string): string {
  return CHANNEL_STATE_LABELS[state as ChannelOrderState] ?? "Unknown status";
}

// The marketplace's own status word, shown only as secondary detail.
export function externalStatusLabel(status: string): string {
  return status.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export interface Deadline {
  // 'none' when the marketplace sent no deadline.
  kind: "none" | "open" | "urgent" | "passed";
  text: string;
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return m > 0 ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
}

export function deadlineState(acceptBy: string | null, now: number): Deadline {
  if (!acceptBy) return { kind: "none", text: "No deadline from the marketplace. Accept it as soon as you can." };
  const left = new Date(acceptBy).getTime() - now;
  if (Number.isNaN(left)) return { kind: "none", text: "No deadline from the marketplace. Accept it as soon as you can." };
  if (left <= 0) {
    return {
      kind: "passed",
      text: "The acceptance window has passed. The marketplace may already have rejected this order.",
    };
  }
  return { kind: left <= 2 * 60_000 ? "urgent" : "open", text: `Accept within ${formatRemaining(left)}` };
}

// Why the "enabled" switch cannot be turned on, in words, or null when it can.
// Turning OFF is always allowed, so an enabled connection never gets a reason.
export function enableBlockedReason(
  conn: ChannelConnection,
  provider: ChannelProviderInfo | undefined,
  flagOn: boolean,
): string | null {
  if (conn.enabled) return null;
  if (!provider) return "This marketplace is not available right now.";
  if (!flagOn) return "Marketplace channels are not available for your shop yet.";
  if (!conn.externalLocationId) return "Add the location ID first.";
  if (!conn.hasCredentials) return "Add the marketplace credentials first.";
  if (!conn.hasWebhookSecret && !provider.capabilities.platformWebhookSecret) return "Add the webhook secret first.";
  if (!provider.capabilities.provesLocationOwnership && !conn.locationVerified) {
    return "Waiting for Requital to verify your location with the marketplace.";
  }
  return null;
}

export type VerificationView = "verified" | "waiting" | "automatic";

export function verificationView(conn: ChannelConnection, provider: ChannelProviderInfo | undefined): VerificationView {
  if (conn.locationVerified) return "verified";
  return provider?.capabilities.provesLocationOwnership ? "automatic" : "waiting";
}

export type ConnectionStatus = "live" | "off" | "waiting_verification" | "needs_setup";

export function connectionStatus(conn: ChannelConnection, provider: ChannelProviderInfo | undefined): ConnectionStatus {
  if (conn.enabled) return "live";
  if (!conn.externalLocationId || !conn.hasCredentials) return "needs_setup";
  if (verificationView(conn, provider) === "waiting") return "waiting_verification";
  return "off";
}

export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  live: "Live",
  off: "Off",
  waiting_verification: "Waiting for verification",
  needs_setup: "Needs setup",
};

// ---- Payload builders. A secret goes out only when the user typed it. ----

const trimOrEmpty = (v: string) => v.trim();

export interface ConnectionFormValues {
  outletId: number;
  provider: string;
  externalLocationId: string;
  externalBrandId: string;
  externalSiteId: string;
  // key -> what the user typed ("" = not typed).
  credentials: Record<string, string>;
  webhookSecret: string;
}

// The credentials map only if EVERY declared field was typed: the API replaces
// the whole map, so a partial replace would silently drop the others.
export function typedCredentials(
  fields: { key: string }[],
  typed: Record<string, string>,
): { ok: true; value: Record<string, string> | undefined } | { ok: false } {
  const entries = fields.map((f) => [f.key, typed[f.key] ?? ""] as const);
  const any = entries.some(([, v]) => v.length > 0);
  if (!any) return { ok: true, value: undefined };
  if (entries.some(([, v]) => v.length === 0)) return { ok: false };
  return { ok: true, value: Object.fromEntries(entries) };
}

export function buildCreatePayload(
  v: ConnectionFormValues,
  fields: { key: string }[],
): ChannelConnectionInput | { error: string } {
  const creds = typedCredentials(fields, v.credentials);
  if (!creds.ok) return { error: "Fill in every credential field, or leave them all empty and add them later." };
  const out: ChannelConnectionInput = { outletId: v.outletId, provider: v.provider };
  if (trimOrEmpty(v.externalLocationId)) out.externalLocationId = trimOrEmpty(v.externalLocationId);
  if (trimOrEmpty(v.externalBrandId)) out.externalBrandId = trimOrEmpty(v.externalBrandId);
  if (trimOrEmpty(v.externalSiteId)) out.externalSiteId = trimOrEmpty(v.externalSiteId);
  if (creds.value) out.credentials = creds.value;
  if (v.webhookSecret) out.webhookSecret = v.webhookSecret;
  return out;
}

// Only what changed. Credentials and the webhook secret appear only when typed.
export function buildUpdatePayload(
  current: ChannelConnection,
  v: ConnectionFormValues,
  fields: { key: string }[],
): ChannelConnectionUpdate | { error: string } {
  const creds = typedCredentials(fields, v.credentials);
  if (!creds.ok) return { error: "To replace the credentials, fill in every credential field." };
  const out: ChannelConnectionUpdate = {};
  const idFields = ["externalLocationId", "externalBrandId", "externalSiteId"] as const;
  for (const k of idFields) {
    const next = trimOrEmpty(v[k]) || null;
    if (next !== (current[k] ?? null)) out[k] = next;
  }
  if (creds.value) out.credentials = creds.value;
  if (v.webhookSecret) out.webhookSecret = v.webhookSecret;
  return out;
}
