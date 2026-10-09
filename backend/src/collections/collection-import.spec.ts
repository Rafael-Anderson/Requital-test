import {
  CollectionColumnsError,
  creationOrder,
  parseCollectionRows,
  planCollectionImport,
  type ExistingCollection,
} from './collection-import';

function plan(
  table: string[][],
  existing: ExistingCollection[] = [],
  onExisting: 'update' | 'skip' = 'update',
) {
  const [header, ...data] = table;
  const rows = data.map((r) =>
    Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])),
  );
  const parsed = parseCollectionRows(rows, header);
  return planCollectionImport(parsed.rows, existing, onExisting);
}

const ex = (
  id: number,
  name: string,
  slug: string,
  parent: number | null = null,
  extra: Partial<ExistingCollection> = {},
): ExistingCollection => ({
  id,
  name,
  slug,
  parentCollectionId: parent,
  description: null,
  image: null,
  ...extra,
});

describe('parseCollectionRows', () => {
  it('matches English and Arabic headers tolerantly and reports unknown columns', () => {
    const parsed = parseCollectionRows(
      [{ '﻿اسم التصنيف': 'ورد', 'التصنيف الأب': '', الوصف: 'd', Extra: 'x' }],
      ['﻿اسم التصنيف', 'التصنيف الأب', 'الوصف', 'Extra'],
    );
    expect(parsed.rows[0]).toMatchObject({
      name: 'ورد',
      description: 'd',
      parentRef: null,
    });
    expect(parsed.unsupportedColumns).toEqual(['Extra']);
  });

  it('refuses a file without a name column', () => {
    expect(() => parseCollectionRows([{ a: '1' }], ['a'])).toThrow(
      CollectionColumnsError,
    );
  });

  it('flags a bad slug and drops a bad image URL with a warning', () => {
    const [r] = parseCollectionRows(
      [{ name: 'A', slug: 'Bad Slug!', image: 'ftp://x/y.jpg' }],
      ['name', 'slug', 'image'],
    ).rows;
    expect(r.errors.join()).toMatch(/Slug may only/);
    expect(r.image).toBeNull();
    expect(r.warnings.join()).toMatch(/not an http/);
  });
});

describe('planCollectionImport', () => {
  it('creates new collections and derives deterministic slugs (Arabic kept)', () => {
    const plans = plan([['name'], ['Roses'], ['باقات ورد']]);
    expect(plans.map((p) => [p.action, p.newSlug])).toEqual([
      ['create', 'roses'],
      ['create', 'باقات-ورد'],
    ]);
  });

  it('is idempotent: a second run over the same names skips everything', () => {
    const existing = [ex(1, 'Roses', 'roses'), ex(2, 'Tulips', 'tulips', 1)];
    const plans = plan(
      [
        ['name', 'parent'],
        ['Roses', ''],
        ['Tulips', 'Roses'],
      ],
      existing,
    );
    expect(plans.map((p) => p.action)).toEqual(['skip', 'skip']);
  });

  it('matches by slug when given and updates the name, description and image', () => {
    const plans = plan(
      [
        ['name', 'slug', 'description', 'image'],
        ['Red Roses', 'roses', 'Fresh', 'https://c.test/a.jpg'],
      ],
      [ex(1, 'Roses', 'roses')],
    );
    expect(plans[0].action).toBe('update');
    expect(plans[0].changes.map((c) => c.field)).toEqual([
      'Name',
      'Description',
      'Image',
    ]);
  });

  it('a blank description or image never clears an existing one', () => {
    const plans = plan(
      [
        ['name', 'description', 'image'],
        ['Roses', '', ''],
      ],
      [
        ex(1, 'Roses', 'roses', null, {
          description: 'keep',
          image: 'https://c.test/a.jpg',
        }),
      ],
    );
    expect(plans[0].action).toBe('skip');
  });

  it('onExisting=skip leaves matched rows alone, even with new data', () => {
    const plans = plan(
      [
        ['name', 'description'],
        ['Roses', 'new'],
      ],
      [ex(1, 'Roses', 'roses')],
      'skip',
    );
    expect(plans[0]).toMatchObject({
      action: 'skip',
      reason: 'Already exists, kept as it is',
    });
  });

  it('matches names case-insensitively and refuses an ambiguous name', () => {
    expect(plan([['name'], ['roses']], [ex(1, 'ROSES', 'r1')])[0].action).toBe(
      'skip',
    );
    const ambiguous = plan(
      [['name'], ['Sale']],
      [ex(1, 'Sale', 'sale-m', 5), ex(2, 'Sale', 'sale-w', 6)],
    );
    expect(ambiguous[0].action).toBe('error');
    expect(ambiguous[0].errors.join()).toMatch(/slug column/);
  });

  it('a derived slug that is taken by another collection gets a suffix', () => {
    const plans = plan([['name'], ['Roses!']], [ex(1, 'Other', 'roses')]);
    expect(plans[0].newSlug).toBe('roses-2');
  });

  it('puts a child under a parent created in the same file, in any row order', () => {
    const plans = plan([
      ['name', 'parent'],
      ['Leaf', 'Mid'],
      ['Mid', 'Top'],
      ['Top', ''],
    ]);
    expect(plans.map((p) => p.action)).toEqual(['create', 'create', 'create']);
    expect(plans.map((p) => p.depth)).toEqual([2, 1, 0]);
    expect(creationOrder(plans).map((p) => p.name)).toEqual([
      'Top',
      'Mid',
      'Leaf',
    ]);
  });

  it('resolves a parent by slug or name, and rejects unknown and ambiguous parents', () => {
    const existing = [
      ex(1, 'Sale', 'sale-m'),
      ex(2, 'Sale', 'sale-w'),
      ex(3, 'Gifts', 'gifts'),
    ];
    const plans = plan(
      [
        ['name', 'parent'],
        ['A', 'sale-m'],
        ['B', 'Sale'],
        ['C', 'Nope'],
        ['D', 'gifts'],
        ['E', 'Gifts'],
      ],
      existing,
    );
    expect(plans.map((p) => p.action)).toEqual([
      'create',
      'error',
      'error',
      'create',
      'create',
    ]);
    expect(plans[1].errors.join()).toMatch(/more than one/);
    expect(plans[2].errors.join()).toMatch(/not found/);
    expect(plans[0].parentKey).toBe('e:1');
  });

  it('refuses a cycle inside the file and a self-parent', () => {
    const plans = plan([
      ['name', 'parent'],
      ['A', 'B'],
      ['B', 'A'],
      ['C', 'C'],
      ['D', ''],
    ]);
    expect(plans.map((p) => p.action)).toEqual([
      'error',
      'error',
      'error',
      'create',
    ]);
    expect(plans[0].errors.join()).toMatch(/loops back/);
  });

  it('refuses re-parenting an existing collection under its own descendant', () => {
    const existing = [
      ex(1, 'Top', 'top'),
      ex(2, 'Mid', 'mid', 1),
      ex(3, 'Leaf', 'leaf', 2),
    ];
    const plans = plan(
      [
        ['name', 'parent'],
        ['Top', 'Leaf'],
      ],
      existing,
    );
    expect(plans[0].action).toBe('error');
    expect(plans[0].errors.join()).toMatch(/loops back/);
  });

  it('moves an existing collection to a new parent and reports the change', () => {
    const existing = [ex(1, 'A', 'a'), ex(2, 'B', 'b'), ex(3, 'C', 'c', 1)];
    const plans = plan(
      [
        ['name', 'parent'],
        ['C', 'B'],
      ],
      existing,
    );
    expect(plans[0].action).toBe('update');
    expect(plans[0].changes).toEqual([{ field: 'Parent', from: 'A', to: 'B' }]);
    expect(plans[0].parentKey).toBe('e:2');
  });

  it('a blank parent leaves an existing collection where it is', () => {
    const plans = plan(
      [
        ['name', 'parent'],
        ['C', ''],
      ],
      [ex(1, 'A', 'a'), ex(3, 'C', 'c', 1)],
    );
    expect(plans[0].action).toBe('skip');
  });

  it('the same collection twice in a file is an error on the second row', () => {
    const plans = plan([['name'], ['Roses'], ['roses']]);
    expect(plans[1].action).toBe('error');
    expect(plans[1].errors.join()).toMatch(/row 2/);
  });

  it('a child of an errored new row is an error too', () => {
    const plans = plan([
      ['name', 'parent', 'slug'],
      ['Bad', '', 'BAD SLUG'],
      ['Kid', 'Bad', ''],
    ]);
    expect(plans[0].action).toBe('error');
    expect(plans[1].action).toBe('error');
  });

  it('handles an unlimited-depth chain without recursion limits', () => {
    const depth = 3000;
    const table: string[][] = [['name', 'parent']];
    for (let i = depth - 1; i >= 0; i -= 1)
      table.push([`c${i}`, i === 0 ? '' : `c${i - 1}`]);
    const plans = plan(table);
    expect(plans.every((p) => p.action === 'create')).toBe(true);
    const order = creationOrder(plans);
    expect(order[0].name).toBe('c0');
    expect(order).toHaveLength(depth);
    expect(Math.max(...plans.map((p) => p.depth!))).toBe(depth - 1);
  });
});
