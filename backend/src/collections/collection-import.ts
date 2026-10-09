// Collections CSV/XLSX import (ONB-1). PURE: no I/O. The file lists collections
// (name, optional parent, slug, description, image URL); the planner matches
// them to the shop's existing tree and decides create / update / skip / error
// for each row. The service writes exactly the plan.
//
// RULES (pinned by collection-import.spec.ts):
//  * Identity. A row WITH a slug matches the existing collection of that slug.
//    A row WITHOUT one matches the existing collection of that name (trimmed,
//    case-insensitive); two existing collections with that name make the row an
//    error ("use the slug column"), never a guess.
//  * A parent is named by slug or by name. A name that points at more than one
//    collection is an error. A blank parent leaves an existing collection where
//    it is and puts a new one at the top.
//  * The tree has unlimited depth and no cycles: every row's ancestor chain is
//    walked over the combined (existing + file) parent map, and a row that
//    would loop, or that is its own parent, is an error.
//  * Unknown stays unknown: a blank description or image never clears one.
//  * Nothing is fetched. An image cell is a URL recorded as text.

import { createHash } from 'crypto';
import { normaliseHeader } from '../products/platform-import';
import { NAME_MAX, validImageUrl } from '../products/shopify-import';

export const MAX_COLLECTION_ROWS = 5_000;
const DESCRIPTION_MAX = 20_000;

const ALIASES = {
  name: [
    'name',
    'collection name',
    'category name',
    'title',
    'اسم التصنيف',
    'اسم المجموعة',
    'الاسم',
    'التصنيف',
  ],
  parent: [
    'parent',
    'parent collection',
    'parent category',
    'parent name',
    'parent slug',
    'التصنيف الاب',
    'التصنيف الرئيسي',
    'المجموعة الاب',
  ],
  slug: ['slug', 'handle', 'url key', 'رابط التصنيف'],
  description: ['description', 'الوصف'],
  image: ['image', 'image url', 'image src', 'الصورة', 'صورة التصنيف'],
} as const;
type Field = keyof typeof ALIASES;

export class CollectionColumnsError extends Error {
  constructor(readonly expected: string[]) {
    super(
      `This does not look like a collections file. A name column is required (${expected.slice(0, 4).join(' / ')})`,
    );
  }
}

export interface CollectionRowIn {
  rowNumber: number;
  name: string;
  slug: string | null;
  parentRef: string | null;
  description: string | null;
  image: string | null;
  errors: string[];
  warnings: string[];
}

const SLUG_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;

export function deriveCollectionSlug(name: string): string {
  const base = name
    .normalize('NFKC')
    .replace(/[ً-ٰٟـ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
  return (
    base ||
    `collection-${createHash('sha1').update(name).digest('hex').slice(0, 8)}`
  );
}

export function parseCollectionRows(
  rows: Record<string, string>[],
  headers: string[],
): { rows: CollectionRowIn[]; unsupportedColumns: string[] } {
  const byNormal = new Map<string, string>();
  for (const h of headers) {
    const key = normaliseHeader(h);
    if (key && !byNormal.has(key)) byNormal.set(key, h);
  }
  const col = {} as Record<Field, string | undefined>;
  const used = new Set<string>();
  for (const field of Object.keys(ALIASES) as Field[]) {
    for (const alias of ALIASES[field]) {
      const h = byNormal.get(normaliseHeader(alias));
      if (h !== undefined && !used.has(h)) {
        col[field] = h;
        used.add(h);
        break;
      }
    }
  }
  if (!col.name) throw new CollectionColumnsError([...ALIASES.name]);
  const get = (row: Record<string, string>, f: Field) =>
    col[f] ? (row[col[f]!] ?? '').trim() : '';

  const out: CollectionRowIn[] = rows.map((row, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const name = get(row, 'name');
    if (!name) errors.push('Name is required');
    if (name.length > NAME_MAX)
      errors.push(`Name is longer than ${NAME_MAX} characters`);
    let slug: string | null = get(row, 'slug').toLowerCase() || null;
    if (slug !== null && (slug.length > NAME_MAX || !SLUG_PATTERN.test(slug))) {
      errors.push(
        'Slug may only contain letters, digits, hyphens and underscores',
      );
      slug = null;
    }
    let image: string | null = get(row, 'image') || null;
    if (image !== null) {
      const checked = validImageUrl(image);
      if (!checked.url) {
        warnings.push(`Image URL ${checked.reason}, so it was skipped`);
        image = null;
      } else image = checked.url;
    }
    let description: string | null = get(row, 'description') || null;
    if (description !== null && description.length > DESCRIPTION_MAX) {
      errors.push(`Description is longer than ${DESCRIPTION_MAX} characters`);
    }
    return {
      rowNumber: index + 2,
      name,
      slug,
      parentRef: get(row, 'parent') || null,
      description,
      image,
      errors,
      warnings,
    };
  });
  const unsupported = new Set<string>();
  for (const h of headers) {
    if (h === '' || used.has(h)) continue;
    if (rows.some((r) => (r[h] ?? '').trim() !== '')) unsupported.add(h);
  }
  return { rows: out, unsupportedColumns: [...unsupported].sort() };
}

// ---------------------------------------------------------------- planning

export interface ExistingCollection {
  id: number;
  name: string;
  slug: string;
  parentCollectionId: number | null;
  description: string | null;
  image: string | null;
}

export type CollectionAction = 'create' | 'update' | 'skip' | 'error';

export interface CollectionChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface CollectionPlanRow {
  rowNumber: number;
  name: string;
  action: CollectionAction;
  reason: string | null;
  changes: CollectionChange[];
  warnings: string[];
  errors: string[];
  // How many collections above this one (0 = top level), when known.
  depth: number | null;
  // ---- what the writer needs (never shown) ----
  /** 'e:<id>' for an existing collection, 'n:<slug>' for one to create. */
  key: string;
  existingId: number | null;
  newSlug: string | null;
  /** undefined: leave the parent alone. null: top level. string: entity key. */
  parentKey: string | null | undefined;
  set: { name?: string; description?: string; image?: string };
}

export type OnExisting = 'update' | 'skip';

const lower = (s: string) => s.trim().toLowerCase();

export function planCollectionImport(
  input: CollectionRowIn[],
  existing: ExistingCollection[],
  onExisting: OnExisting,
): CollectionPlanRow[] {
  const bySlug = new Map(existing.map((c) => [c.slug.toLowerCase(), c]));
  const byName = new Map<string, ExistingCollection[]>();
  for (const c of existing) {
    const list = byName.get(lower(c.name)) ?? [];
    list.push(c);
    byName.set(lower(c.name), list);
  }
  const byId = new Map(existing.map((c) => [c.id, c]));

  const plans: CollectionPlanRow[] = input.map((r) => ({
    rowNumber: r.rowNumber,
    name: r.name,
    action: 'error',
    reason: null,
    changes: [],
    warnings: [...r.warnings],
    errors: [...r.errors],
    depth: null,
    key: '',
    existingId: null,
    newSlug: null,
    parentKey: undefined,
    set: {},
  }));

  // ---- 1. identity of every row ----
  const usedSlugs = new Set(existing.map((c) => c.slug.toLowerCase()));
  const keyOwner = new Map<string, number>(); // entity key -> first row index
  const newNames = new Map<string, number>(); // new, slug-less rows by name
  input.forEach((r, i) => {
    const plan = plans[i];
    if (plan.errors.length > 0) return;
    let match: ExistingCollection | undefined;
    if (r.slug) {
      match = bySlug.get(r.slug);
    } else {
      const candidates = byName.get(lower(r.name)) ?? [];
      if (candidates.length > 1) {
        plan.errors.push(
          `${candidates.length} existing collections are named this. Add a slug column to say which one.`,
        );
        return;
      }
      match = candidates[0];
    }
    if (match) {
      plan.key = `e:${match.id}`;
      plan.existingId = match.id;
    } else {
      if (!r.slug) {
        const earlier = newNames.get(lower(r.name));
        if (earlier !== undefined) {
          plan.errors.push(
            `Same collection as row ${plans[earlier].rowNumber}. Each collection can appear once.`,
          );
          return;
        }
        newNames.set(lower(r.name), i);
      }
      let slug = r.slug ?? deriveCollectionSlug(r.name);
      if (!r.slug) {
        let n = 2;
        const base = slug;
        while (usedSlugs.has(slug)) {
          slug = `${base}-${n}`.slice(0, NAME_MAX);
          n += 1;
        }
      }
      usedSlugs.add(slug);
      plan.key = `n:${slug}`;
      plan.newSlug = slug;
    }
    const owner = keyOwner.get(plan.key);
    if (owner !== undefined) {
      plan.errors.push(
        `Same collection as row ${plans[owner].rowNumber}. Each collection can appear once.`,
      );
      plan.key = '';
      return;
    }
    keyOwner.set(plan.key, i);
  });

  // ---- 2. parents ----
  // Entities by slug and by name, over the file AND the existing tree.
  const slugEntity = new Map<string, string>(); // lower slug -> key
  const nameEntities = new Map<string, Set<string>>(); // lower name -> keys
  const addName = (name: string, key: string) => {
    const set = nameEntities.get(lower(name)) ?? new Set<string>();
    set.add(key);
    nameEntities.set(lower(name), set);
  };
  for (const c of existing) {
    slugEntity.set(c.slug.toLowerCase(), `e:${c.id}`);
    addName(c.name, `e:${c.id}`);
  }
  plans.forEach((p) => {
    if (!p.key) return;
    if (p.newSlug) slugEntity.set(p.newSlug, p.key);
    addName(p.name, p.key);
  });

  input.forEach((r, i) => {
    const plan = plans[i];
    if (!plan.key || plan.errors.length > 0) return;
    if (r.parentRef === null) {
      // New: top level. Existing: unchanged.
      plan.parentKey = plan.existingId === null ? null : undefined;
      return;
    }
    const ref = lower(r.parentRef);
    const bySlugKey = slugEntity.get(ref);
    const named = nameEntities.get(ref);
    let target: string | undefined = bySlugKey;
    if (!target) {
      if (!named || named.size === 0) {
        plan.errors.push(
          'Parent was not found. Name an existing collection or another row.',
        );
        return;
      }
      if (named.size > 1) {
        plan.errors.push(
          'Parent matches more than one collection. Use its slug.',
        );
        return;
      }
      target = [...named][0];
    }
    plan.parentKey = target;
  });

  // ---- 3. cycles, over the combined parent map ----
  const parentOf = new Map<string, string | null>();
  for (const c of existing) {
    parentOf.set(
      `e:${c.id}`,
      c.parentCollectionId === null ? null : `e:${c.parentCollectionId}`,
    );
  }
  for (const p of plans) {
    if (!p.key || p.errors.length > 0) continue;
    if (p.parentKey !== undefined) parentOf.set(p.key, p.parentKey);
    else if (!parentOf.has(p.key)) parentOf.set(p.key, null);
  }
  const depthOf = (start: string): number | null => {
    const seen = new Set<string>([start]);
    let depth = 0;
    let cursor = parentOf.get(start) ?? null;
    while (cursor !== null) {
      if (seen.has(cursor)) return null; // a loop
      seen.add(cursor);
      depth += 1;
      cursor = parentOf.get(cursor) ?? null;
    }
    return depth;
  };
  // Rows that are errors do not contribute their parent link.
  for (const p of plans) {
    if (!p.key || p.errors.length > 0) continue;
    const depth = depthOf(p.key);
    if (depth === null) {
      p.errors.push('The parent chain loops back to this collection');
    } else {
      p.depth = depth;
    }
  }
  // A row that points at an errored row cannot be created under it.
  const errored = new Set(
    plans.filter((p) => p.errors.length > 0 && p.key).map((p) => p.key),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of plans) {
      if (p.errors.length > 0 || !p.key) continue;
      if (
        p.parentKey &&
        p.parentKey.startsWith('n:') &&
        errored.has(p.parentKey)
      ) {
        p.errors.push('Its parent row has an error');
        errored.add(p.key);
        changed = true;
      }
    }
  }

  // ---- 4. classify ----
  input.forEach((r, i) => {
    const plan = plans[i];
    if (plan.errors.length > 0 || !plan.key) {
      plan.action = 'error';
      return;
    }
    if (plan.existingId === null) {
      plan.action = 'create';
      if (r.description) plan.set.description = r.description;
      if (r.image) plan.set.image = r.image;
      plan.set.name = r.name;
      return;
    }
    const current = byId.get(plan.existingId)!;
    if (onExisting === 'skip') {
      plan.action = 'skip';
      plan.reason = 'Already exists, kept as it is';
      plan.parentKey = undefined;
      return;
    }
    const diff = (
      field: string,
      from: string | null,
      to: string | null,
      col: 'name' | 'description' | 'image',
    ) => {
      if (to === null || to === from) return;
      plan.changes.push({ field, from, to });
      plan.set[col] = to;
    };
    // A row matched by slug may carry a new name; one matched by name already has it.
    if (r.slug) diff('Name', current.name, r.name, 'name');
    diff('Description', current.description, r.description, 'description');
    diff('Image', current.image, r.image, 'image');
    if (plan.parentKey !== undefined) {
      const currentKey =
        current.parentCollectionId === null
          ? null
          : `e:${current.parentCollectionId}`;
      if (plan.parentKey === currentKey) {
        plan.parentKey = undefined;
      } else {
        plan.changes.push({
          field: 'Parent',
          from:
            currentKey === null
              ? null
              : (byId.get(current.parentCollectionId!)?.name ?? null),
          to: r.parentRef,
        });
      }
    }
    if (plan.changes.length === 0) {
      plan.action = 'skip';
      plan.reason = 'No changes';
    } else {
      plan.action = 'update';
    }
  });
  return plans;
}

// New collections ordered so every parent is created before its children.
export function creationOrder(plans: CollectionPlanRow[]): CollectionPlanRow[] {
  const creates = plans.filter((p) => p.action === 'create');
  const byKey = new Map(creates.map((p) => [p.key, p]));
  const out: CollectionPlanRow[] = [];
  const done = new Set<string>();
  const visit = (p: CollectionPlanRow) => {
    // Iterative climb: a deep chain must not overflow the stack.
    const stack: CollectionPlanRow[] = [];
    let cursor: CollectionPlanRow | undefined = p;
    while (cursor && !done.has(cursor.key)) {
      stack.push(cursor);
      cursor = cursor.parentKey ? byKey.get(cursor.parentKey) : undefined;
    }
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (!done.has(next.key)) {
        done.add(next.key);
        out.push(next);
      }
    }
  };
  creates.forEach(visit);
  return out;
}
