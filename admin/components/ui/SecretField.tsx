"use client";

import { useEffect, useState } from "react";
import Input from "./Input";
import Button from "./Button";

// Shared "write-only secret" field — used everywhere a merchant enters an
// API key/access token (Payment Gateways, WhatsApp Business API). Once a
// value is saved, the real value is never shown again: only the masked
// placeholder (e.g. "••••1234") the backend returns, behind a "Replace"
// button. Clicking Replace reveals a real input to type a new value into;
// `onChange`'s value is only ever sent on the parent's own Save action, not
// from this component directly (this stays a dumb controlled field, same
// division of responsibility Input.tsx has). `masked` re-syncs `editing`
// back to closed whenever it changes (i.e. right after the parent's Save
// call round-trips and refetches) — a Replace click mid-edit is never
// fought, since `masked` itself doesn't change until a real save happens.
export default function SecretField({
  label,
  masked,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  masked: string | null;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(!masked);

  useEffect(() => {
    setEditing(!masked);
  }, [masked]);

  if (masked && !editing) {
    return (
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-text-secondary dark:text-zinc-400">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <span className="flex h-9 flex-1 items-center rounded-[10px] border border-border bg-black/[0.02] px-3 text-sm text-text-muted dark:border-white/15 dark:bg-white/[0.03]">
            {masked}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Replace
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Input
      label={label}
      type="password"
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}
