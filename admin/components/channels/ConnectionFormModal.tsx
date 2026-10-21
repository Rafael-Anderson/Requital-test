"use client";

import { useMemo, useState } from "react";
import { createChannelConnection, updateChannelConnection } from "@/lib/api";
import { buildCreatePayload, buildUpdatePayload, providerLabel, type ConnectionFormValues } from "@/lib/channels";
import type { ChannelConnection, ChannelProviderInfo, Outlet } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import Modal from "@/components/ui/Modal";
import SecretField from "@/components/ui/SecretField";
import Select from "@/components/ui/Select";

const SAVED = "Saved, hidden";

// Create or edit one (outlet, marketplace) connection. Credentials and the
// webhook secret are write-only: a saved one shows as a masked row with Replace,
// is never echoed back, and is sent only when the user typed it. The ids are
// plain text fields with no defaults: they are the marketplace's own ids for this
// branch and must be copied from its partner portal, never guessed.
export default function ConnectionFormModal({
  connection,
  providers,
  outlets,
  existing,
  onClose,
  onSaved,
}: {
  // null = create
  connection: ChannelConnection | null;
  providers: ChannelProviderInfo[];
  outlets: Outlet[];
  // Every connection the shop has, to offer only free (outlet, marketplace) pairs.
  existing: ChannelConnection[];
  onClose: () => void;
  onSaved: (saved: ChannelConnection) => void;
}) {
  const editing = connection !== null;
  // A live connection's ids and credentials cannot change under it (the API
  // refuses): say so instead of letting the merchant type into a dead form.
  const locked = !!connection?.enabled;

  const [provider, setProvider] = useState(connection?.provider ?? providers[0]?.name ?? "");
  const freeOutlets = useMemo(
    () => outlets.filter((o) => !existing.some((c) => c.outletId === o.id && c.provider === provider)),
    [outlets, existing, provider],
  );
  const [outletId, setOutletId] = useState<number>(connection?.outletId ?? 0);
  const [locationId, setLocationId] = useState(connection?.externalLocationId ?? "");
  const [brandId, setBrandId] = useState(connection?.externalBrandId ?? "");
  const [siteId, setSiteId] = useState(connection?.externalSiteId ?? "");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [replacingCreds, setReplacingCreds] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const info = providers.find((p) => p.name === provider);
  const fields = info?.credentialFields ?? [];
  const needsSecret = !!info && !info.capabilities.platformWebhookSecret;
  const effectiveOutletId = editing ? connection.outletId : freeOutlets.some((o) => o.id === outletId) ? outletId : (freeOutlets[0]?.id ?? 0);
  const credsSaved = editing && connection.hasCredentials && !replacingCreds;

  async function submit(e: React.FormEvent, requestClose: () => void) {
    e.preventDefault();
    setError(null);
    if (!editing && !effectiveOutletId) {
      setError("Choose an outlet. Every outlet already has a connection for this marketplace.");
      return;
    }
    const values: ConnectionFormValues = {
      outletId: effectiveOutletId,
      provider,
      externalLocationId: locationId,
      externalBrandId: brandId,
      externalSiteId: siteId,
      credentials: creds,
      webhookSecret,
    };
    setSaving(true);
    try {
      if (editing) {
        const payload = buildUpdatePayload(connection, values, fields);
        if ("error" in payload) {
          setError(payload.error);
          return;
        }
        // Nothing changed: no request, no audit row.
        if (Object.keys(payload).length === 0) {
          requestClose();
          return;
        }
        onSaved(await updateChannelConnection(connection.id, payload));
      } else {
        const payload = buildCreatePayload(values, fields);
        if ("error" in payload) {
          setError(payload.error);
          return;
        }
        onSaved(await createChannelConnection(payload));
      }
      requestClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the connection");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="md" title={editing ? `Edit ${providerLabel(provider, providers)} connection` : "Add a sales channel"}>
      {(requestClose) => (
        <form onSubmit={(e) => submit(e, requestClose)} className="space-y-5" noValidate>
          {locked && (
            <p className="rounded-xl bg-warning-bg p-3 text-[13px] text-warning-text dark:bg-amber-500/10 dark:text-amber-300">
              This connection is live, so its location, credentials and webhook secret cannot be changed. Turn it off first,
              then edit. Changing the location ID or the credentials asks Requital to verify the location again.
            </p>
          )}

          {!editing && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select label="Marketplace" value={provider} onChange={(e) => setProvider(e.target.value)}>
                {providers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {providerLabel(p.name, providers)}
                  </option>
                ))}
              </Select>
              <Select
                label="Outlet"
                value={effectiveOutletId || ""}
                onChange={(e) => setOutletId(Number(e.target.value))}
                disabled={freeOutlets.length === 0}
              >
                {freeOutlets.length === 0 && <option value="">No outlet available</option>}
                {freeOutlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <fieldset disabled={locked} className="space-y-4 disabled:opacity-70">
            <legend className="mb-1 text-[13px] font-bold text-text-primary dark:text-zinc-50">Where this outlet is on the marketplace</legend>
            <p className="text-xs text-text-faint">
              Copy these exactly from the marketplace&apos;s partner portal. Requital does not guess them, and a wrong location ID
              sends orders to the wrong place.
            </p>
            <Input
              label="Location ID"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              maxLength={191}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Brand ID (if the marketplace gave you one)" value={brandId} onChange={(e) => setBrandId(e.target.value)} maxLength={191} autoComplete="off" spellCheck={false} />
              <Input label="Site ID (if the marketplace gave you one)" value={siteId} onChange={(e) => setSiteId(e.target.value)} maxLength={191} autoComplete="off" spellCheck={false} />
            </div>
          </fieldset>

          <fieldset disabled={locked} className="space-y-4 disabled:opacity-70">
            <legend className="mb-1 text-[13px] font-bold text-text-primary dark:text-zinc-50">Credentials</legend>
            <p className="text-xs text-text-faint">
              Stored encrypted and never shown again. {editing ? "Replace them only if the marketplace issued new ones." : "You can add them later."}
            </p>
            {fields.length === 0 ? (
              <p className="text-[13px] text-text-muted">
                The credential form for this marketplace is not available yet. Ask Requital support to finish setting it up.
              </p>
            ) : (
              fields.map((f) => (
                <SecretField
                  key={f.key}
                  label={f.label}
                  masked={credsSaved ? SAVED : null}
                  value={creds[f.key] ?? ""}
                  onChange={(v) => setCreds((c) => ({ ...c, [f.key]: v }))}
                  onReplace={() => setReplacingCreds(true)}
                />
              ))
            )}
            {editing && connection.hasCredentials && replacingCreds && (
              <p className="text-xs text-text-faint">Fill in every field to replace the saved credentials. They are replaced together.</p>
            )}
            {needsSecret && (
              <SecretField
                label="Webhook secret"
                masked={editing && connection.hasWebhookSecret ? SAVED : null}
                value={webhookSecret}
                onChange={setWebhookSecret}
              />
            )}
          </fieldset>

          {error && <InlineErrorMessage>{error}</InlineErrorMessage>}

          <div className="sticky bottom-0 flex justify-end gap-2 bg-surface pt-3 dark:bg-zinc-900">
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving} disabled={locked}>
              {editing ? "Save changes" : "Add connection"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
