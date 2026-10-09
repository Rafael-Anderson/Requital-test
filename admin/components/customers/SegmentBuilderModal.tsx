"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createCustomerSegment, previewCustomerSegment, updateCustomerSegment } from "@/lib/api";
import type { CustomerSegment, CustomerTagWithCount } from "@/lib/types";
import {
  FIELD_DEFS,
  FIELD_ORDER,
  MAX_DEPTH,
  SEGMENT_CURRENCIES,
  fromPayload,
  isComplete,
  isGroup,
  newGroup,
  newLeaf,
  toPayload,
  type SegmentField,
  type SegmentGroup,
  type SegmentLeaf,
  type SegmentNode,
} from "@/lib/segment-rules";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import { useToast } from "@/components/ui/Toast";

function LeafEditor({
  leaf,
  tags,
  onChange,
  onRemove,
}: {
  leaf: SegmentLeaf;
  tags: CustomerTagWithCount[];
  onChange: (l: SegmentLeaf) => void;
  onRemove: () => void;
}) {
  const def = FIELD_DEFS[leaf.field];
  return (
    <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1.2fr_1fr_1.2fr_auto]">
      <Select
        label="Field"
        value={leaf.field}
        onChange={(e) => onChange(newLeaf(e.target.value as SegmentField))}
      >
        {FIELD_ORDER.map((f) => (
          <option key={f} value={f}>
            {FIELD_DEFS[f].label}
          </option>
        ))}
      </Select>
      <Select label="Condition" value={leaf.cmp} onChange={(e) => onChange({ ...leaf, cmp: e.target.value })}>
        {def.cmps.map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </Select>
      <div className="flex gap-2">
        {def.input === "consent" && (
          <div className="min-w-0 flex-1">
            <Select label="Channel" value={leaf.channel} onChange={(e) => onChange({ ...leaf, channel: e.target.value as SegmentLeaf["channel"] })}>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
            </Select>
          </div>
        )}
        <div className="min-w-0 flex-1">
          {def.input === "tag" ? (
            <Select label="Tag" value={leaf.value} onChange={(e) => onChange({ ...leaf, value: e.target.value })}>
              <option value="">Choose a tag</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          ) : def.input === "consent" ? (
            <Select label="Answer" value={leaf.value} onChange={(e) => onChange({ ...leaf, value: e.target.value })}>
              <option value="granted">Agreed</option>
              <option value="withdrawn">Withdrawn</option>
              <option value="unknown">Not asked</option>
            </Select>
          ) : def.input === "bool" ? (
            <Select label="Value" value={leaf.value} onChange={(e) => onChange({ ...leaf, value: e.target.value })}>
              <option value="true">Subscribed</option>
              <option value="false">Not subscribed</option>
            </Select>
          ) : (
            <Input
              label={def.input === "region" ? "Region id" : "Value"}
              type={def.input === "date" ? "date" : "text"}
              inputMode={def.input === "money" ? "decimal" : def.input === "date" ? undefined : "numeric"}
              value={leaf.value}
              onChange={(e) => onChange({ ...leaf, value: e.target.value })}
            />
          )}
        </div>
        {def.input === "money" && (
          <div className="w-24 shrink-0">
            <Select label="Currency" value={leaf.currency} onChange={(e) => onChange({ ...leaf, currency: e.target.value })}>
              {SEGMENT_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      <button type="button" onClick={onRemove} aria-label="Remove condition" className="mb-2 cursor-pointer text-text-faint hover:text-red-600">
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

function GroupEditor({
  group,
  depth,
  tags,
  onChange,
  onRemove,
}: {
  group: SegmentGroup;
  depth: number;
  tags: CustomerTagWithCount[];
  onChange: (g: SegmentGroup) => void;
  onRemove?: () => void;
}) {
  const setRule = (i: number, n: SegmentNode) => onChange({ ...group, rules: group.rules.map((r, j) => (j === i ? n : r)) });
  const removeRule = (i: number) => onChange({ ...group, rules: group.rules.filter((_, j) => j !== i) });
  return (
    <div className="space-y-3 rounded-xl border border-border p-3 dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-56">
          <Select label="Match" value={group.op} onChange={(e) => onChange({ ...group, op: e.target.value as "and" | "or" })}>
            <option value="and">All of these</option>
            <option value="or">Any of these</option>
          </Select>
        </div>
        {onRemove && (
          <Button size="sm" variant="secondary" onClick={onRemove}>
            Remove group
          </Button>
        )}
      </div>
      {group.rules.map((r, i) =>
        isGroup(r) ? (
          <GroupEditor key={i} group={r} depth={depth + 1} tags={tags} onChange={(g) => setRule(i, g)} onRemove={() => removeRule(i)} />
        ) : (
          <LeafEditor key={i} leaf={r} tags={tags} onChange={(l) => setRule(i, l)} onRemove={() => removeRule(i)} />
        ),
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => onChange({ ...group, rules: [...group.rules, newLeaf()] })}>
          <Plus className="me-1 size-3.5" /> Condition
        </Button>
        {depth < MAX_DEPTH && (
          <Button size="sm" variant="secondary" onClick={() => onChange({ ...group, rules: [...group.rules, newGroup()] })}>
            <Plus className="me-1 size-3.5" /> Group
          </Button>
        )}
      </div>
    </div>
  );
}

// Builds a segment's rule tree. Members are never stored: they are recomputed
// from the rules every time the segment is opened or exported.
export default function SegmentBuilderModal({
  segment,
  tags,
  onClose,
  onSaved,
}: {
  segment: CustomerSegment | null;
  tags: CustomerTagWithCount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(segment?.name ?? "");
  const [tree, setTree] = useState<SegmentGroup>(() => {
    if (segment) {
      const node = fromPayload(segment.rules);
      return isGroup(node) ? node : { op: "and", rules: [node] };
    }
    return newGroup();
  });
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const previewSeq = useRef(0);

  // A changed tree makes the old count meaningless.
  useEffect(() => {
    previewSeq.current += 1;
  }, [tree]);

  const complete = isComplete(tree);

  async function preview() {
    const id = ++previewSeq.current;
    setError(null);
    try {
      const res = await previewCustomerSegment(toPayload(tree));
      if (id === previewSeq.current) setCount(res.count);
    } catch (err) {
      if (id === previewSeq.current) setError(err instanceof Error ? err.message : "Could not preview");
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const data = { name: name.trim(), rules: toPayload(tree) };
      if (segment) await updateCustomerSegment(segment.id, data);
      else await createCustomerSegment(data);
      toast("Segment saved");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the segment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} size="lg" title={segment ? "Edit segment" : "New segment"}>
      {(requestClose) => (
        <div className="space-y-4">
          <Input label="Name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          <GroupEditor
            group={tree}
            depth={1}
            tags={tags}
            onChange={(g) => {
              setTree(g);
              setCount(null);
            }}
          />
          {error && <InlineErrorMessage>{error}</InlineErrorMessage>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-sm">
              <Button size="sm" variant="secondary" disabled={!complete} onClick={() => void preview()}>
                Preview count
              </Button>
              {count !== null && (
                <span>
                  {count} customer{count === 1 ? "" : "s"} match
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={requestClose}>
                Cancel
              </Button>
              <Button onClick={() => void save()} loading={busy} disabled={busy || !complete || !name.trim()}>
                Save segment
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
