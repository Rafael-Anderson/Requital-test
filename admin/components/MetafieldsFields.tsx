"use client";

import Checkbox from "@/components/ui/Checkbox";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import Toggle from "@/components/ui/Toggle";
import type { MetafieldEditor } from "@/lib/useMetafieldEditor";
import type { MetafieldDefinition } from "@/lib/types";

function Field({
  def,
  draft,
  onChange,
}: {
  def: MetafieldDefinition;
  draft: string | boolean | string[] | null;
  onChange: (next: string | boolean | string[] | null) => void;
}) {
  const options = def.validation?.options ?? [];
  const text = typeof draft === "string" ? draft : "";
  switch (def.type) {
    case "multiline":
      return (
        <Textarea
          label={def.name}
          value={text}
          rows={3}
          maxLength={def.validation?.maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <Input
          label={def.name}
          type="number"
          step={def.validation?.integer ? "1" : "any"}
          min={def.validation?.min}
          max={def.validation?.max}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "date":
      return (
        <Input
          label={def.name}
          type="date"
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "boolean":
      return (
        <div>
          <span className="block mb-1.5 text-[13px] font-medium text-text-secondary dark:text-zinc-400">
            {def.name}
          </span>
          <Toggle
            checked={draft === true}
            onChange={(v) => onChange(v)}
          />
        </div>
      );
    case "json":
      return (
        <Textarea
          label={`${def.name} (JSON)`}
          value={text}
          rows={4}
          spellCheck={false}
          className="font-mono"
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "single_select":
      return (
        <Select
          label={def.name}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Not set</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
    case "multi_select": {
      const chosen = Array.isArray(draft) ? draft : [];
      return (
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-text-secondary dark:text-zinc-400">
            {def.name}
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {options.map((o) => (
              <Checkbox
                key={o}
                label={o}
                checked={chosen.includes(o)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...chosen, o]
                      : chosen.filter((x) => x !== o),
                  )
                }
              />
            ))}
          </div>
        </fieldset>
      );
    }
    default:
      return (
        <Input
          label={def.name}
          value={text}
          maxLength={def.validation?.maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

// The inputs for every custom field of one owner type. Renders nothing while
// loading or when the shop has defined none, so a shop that never uses custom
// fields sees no change anywhere.
export default function MetafieldsFields({ editor }: { editor: MetafieldEditor }) {
  if (editor.loading || editor.defs.length === 0) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
      {editor.defs.map((def) => (
        <div
          key={def.id}
          className={
            def.type === "multiline" || def.type === "json" || def.type === "multi_select"
              ? "sm:col-span-2"
              : ""
          }
        >
          <Field
            def={def}
            draft={editor.drafts[def.id] ?? null}
            onChange={(next) => editor.setDraft(def.id, next)}
          />
        </div>
      ))}
    </div>
  );
}

// Same fields wrapped as a titled section for the product form's Card layout.
export function MetafieldsSection({
  editor,
  title = "Custom fields",
}: {
  editor: MetafieldEditor;
  title?: string;
}) {
  if (editor.loading || editor.defs.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      <MetafieldsFields editor={editor} />
    </div>
  );
}
