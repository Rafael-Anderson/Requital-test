"use client";

// Searchable Google Fonts picker — a Combobox.tsx-shaped wrapper, not a new
// primitive (see lib/google-fonts.ts for the curated option list). The
// picker only needs family names for the dropdown; actual font loading
// happens storefront-side via a dynamic <link> tag (next/font/google can't
// load a runtime-chosen font — see storefront's loader), so no
// font-loading infrastructure exists in admin/ at all.
import Combobox from "./Combobox";
import { GOOGLE_FONTS } from "@/lib/google-fonts";

const OPTIONS = GOOGLE_FONTS.map((name) => ({ value: name, label: name }));

export default function FontPicker({
  label,
  value,
  onChange,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Combobox
      label={label}
      value={value}
      onChange={onChange}
      options={OPTIONS}
      placeholder="Select a font…"
      searchPlaceholder="Search fonts…"
    />
  );
}
