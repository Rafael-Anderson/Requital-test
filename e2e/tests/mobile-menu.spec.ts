import { test, expect, type Page } from '@playwright/test';
import { STOREFRONT_URL } from '../urls';
import { api, seedShop, type SeedState } from '../seed';

// The storefront menu bar on a phone (below md, 768px). It must never scroll sideways: collapsed it
// shows the top-level items that fit on ONE line (the rest are display:none), and a chevron button
// above the row at its start corner, present only when something does not fit, expands it into the
// minimum number of wrapped lines that shows every item. Submenus keep opening on tap in both states.

test.use({ isMobile: true, hasTouch: true });
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const WIDTHS = [320, 360, 390, 430] as const;
const DIRS = ['ltr', 'rtl'] as const;

let seed: SeedState;
let menuItemIds: number[] = [];

test.beforeAll(async () => {
  test.setTimeout(150_000);
  seed = await seedShop();
  const session = seed.session!;
  const names = ['Roses', 'Bouquets and arrangements', 'Gift boxes', 'Orchids', 'Seasonal', 'Weddings', 'Plants', 'Chocolates', 'Balloons'];
  const ids: number[] = [];
  for (const name of names) {
    const c = await api<{ id: number }>('/collections', { method: 'POST', body: JSON.stringify({ name: `${name} ${seed.runId}` }) }, session);
    ids.push(c.id);
  }
  // A dropdown and a mega menu first (so both are on the first line, collapsed too), then links.
  const items: Record<string, unknown>[] = [
    { label: 'Occasions', type: 'DROPDOWN', collections: [{ collectionId: ids[0], sortOrder: 0 }, { collectionId: ids[1], sortOrder: 1 }] },
    {
      label: 'Shop',
      type: 'MEGA',
      columns: [{ title: 'Flowers', sortOrder: 0, links: [{ label: 'Roses', linkType: 'COLLECTION', collectionId: ids[0], sortOrder: 0 }] }],
    },
    ...names.slice(1).map((n, i) => ({ label: n, type: 'LINK', collectionId: ids[i + 1] })),
  ];
  for (const item of items) {
    const created = await api<{ id: number }>('/menu-items', { method: 'POST', body: JSON.stringify(item) }, session);
    menuItemIds.push(created.id);
  }
  expect(menuItemIds.length).toBeGreaterThanOrEqual(8);
});

type MenuState = {
  pageOverflow: number;
  rowOverflowX: string;
  rowScrolls: boolean;
  toggle: null | { left: number; right: number; bottom: number; width: number; height: number; expanded: string | null; controls: string | null; label: string | null };
  rowId: string;
  rowRect: { left: number; right: number; top: number };
  total: number;
  shown: number;
  rows: number;
  expectedRows: number;
  allShownInside: boolean;
};

// Reads the row: items shown, how many lines they occupy, and the minimum number of lines the whole
// menu needs (greedy line filling with the row's real item widths and gap, which is the minimum for
// items kept in order).
async function readMenu(page: Page): Promise<MenuState> {
  return page.evaluate(() => {
    const row = Array.from(document.querySelectorAll<HTMLElement>('[data-menu-row]')).find((r) => r.getClientRects().length > 0)!;
    const wrappers = Array.from(row.querySelectorAll<HTMLElement>(':scope > [data-menu-row-item]'));
    const els = wrappers.map((w) => w.firstElementChild as HTMLElement);
    const shownEls = els.filter((e) => e.getClientRects().length > 0);
    const tops: number[] = [];
    for (const e of shownEls) {
      const t = e.getBoundingClientRect().top;
      if (!tops.some((x) => Math.abs(x - t) <= 2)) tops.push(t);
    }
    const cs = getComputedStyle(row);
    const content = row.clientWidth - parseFloat(cs.paddingInlineStart) - parseFloat(cs.paddingInlineEnd);
    const gap = parseFloat(cs.columnGap) || 0;
    // Widths from the measuring copy (every item, including hidden ones).
    const copy = row.parentElement!.querySelector<HTMLElement>('[data-menu-measure]')!;
    const widths = Array.from(copy.children).map((c) => c.getBoundingClientRect().width);
    let expectedRows = widths.length ? 1 : 0;
    let used = 0;
    for (const w of widths) {
      const need = used === 0 ? w : used + gap + w;
      if (need > content + 0.5 && used > 0) {
        expectedRows++;
        used = w;
      } else used = need;
    }
    const rr = row.getBoundingClientRect();
    const allShownInside = shownEls.every((e) => {
      const r = e.getBoundingClientRect();
      return r.left >= rr.left - 0.5 && r.right <= rr.right + 0.5 && r.left >= 0 && r.right <= document.documentElement.clientWidth + 0.5;
    });
    const t = Array.from(document.querySelectorAll<HTMLElement>('[data-menu-toggle]')).find((b) => b.getClientRects().length > 0);
    const tr = t?.getBoundingClientRect();
    const de = document.documentElement;
    return {
      pageOverflow: de.scrollWidth - de.clientWidth,
      rowOverflowX: cs.overflowX,
      rowScrolls: row.scrollWidth > row.clientWidth + 1,
      toggle:
        t && tr
          ? { left: tr.left, right: tr.right, bottom: tr.bottom, width: tr.width, height: tr.height, expanded: t.getAttribute('aria-expanded'), controls: t.getAttribute('aria-controls'), label: t.getAttribute('aria-label') }
          : null,
      rowId: row.id,
      rowRect: { left: rr.left, right: rr.right, top: rr.top },
      total: els.length,
      shown: shownEls.length,
      rows: tops.length,
      expectedRows,
      allShownInside,
    };
  });
}

async function open(page: Page, width: number, dir: 'ltr' | 'rtl') {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`${STOREFRONT_URL}/${seed.subdomain}`);
  await page.locator('[data-menu-row]').first().waitFor();
  await page.evaluate((d) => {
    document.documentElement.dir = d;
  }, dir);
  // Let a re-measure (ResizeObserver, fonts) settle.
  await page.waitForTimeout(150);
}

async function expectSubmenusOpen(page: Page, label: string) {
  // Dropdown: opens on tap, inside the viewport, and its first link is the topmost element at its
  // own centre (nothing clips or covers it).
  await page.getByRole('button', { name: 'Occasions' }).click();
  const dd = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-dropdown-panel]')!;
    const link = panel.querySelector('a')!;
    const r = link.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { visible: panel.getClientRects().length > 0 && r.height > 0, hitInside: !!hit && link.contains(hit), left: p.left, right: p.right, vw: document.documentElement.clientWidth };
  });
  expect(dd.visible, `${label}: dropdown open`).toBe(true);
  expect(dd.hitInside, `${label}: dropdown link not clipped or covered`).toBe(true);
  expect(dd.left, `${label}: dropdown inside viewport`).toBeGreaterThanOrEqual(0);
  expect(dd.right, `${label}: dropdown inside viewport`).toBeLessThanOrEqual(dd.vw + 0.5);
  await page.locator('body').click({ position: { x: 5, y: 700 } });

  // Mega menu: tap opens its panel (portalled, fixed), first link reachable.
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  const mega = page.getByRole('link', { name: 'Roses' }).last();
  await expect(mega, `${label}: mega panel open`).toBeVisible();
  const megaHit = await mega.evaluate((a) => {
    const r = a.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && a.contains(hit);
  });
  expect(megaHit, `${label}: mega link not clipped or covered`).toBe(true);
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
}

async function checkLongMenu(page: Page, width: number, dir: 'ltr' | 'rtl', withSubmenus: boolean, label: string) {
  await open(page, width, dir);

  // Collapsed.
  let m = await readMenu(page);
  expect(m.pageOverflow, `${label}: page scrolls sideways`).toBeLessThanOrEqual(0);
  expect(m.rowScrolls, `${label}: menu row scrolls sideways`).toBe(false);
  expect(m.rows, `${label}: collapsed is one row`).toBe(1);
  expect(m.shown, `${label}: some items hidden`).toBeLessThan(m.total);
  expect(m.allShownInside, `${label}: no item half cut`).toBe(true);
  expect(m.toggle, `${label}: toggle shown when items overflow`).not.toBeNull();
  const t = m.toggle!;
  expect(t.width, `${label}: 44px target`).toBeGreaterThanOrEqual(44);
  expect(t.height, `${label}: 44px target`).toBeGreaterThanOrEqual(44);
  expect(t.expanded).toBe('false');
  expect(t.controls).toBe(m.rowId);
  expect(t.label).toBe('Show all menu items');
  expect(t.bottom, `${label}: toggle above the row`).toBeLessThanOrEqual(m.rowRect.top + 1);
  if (dir === 'ltr') expect(t.left - m.rowRect.left, `${label}: toggle at the start (left)`).toBeLessThan(24);
  else expect(m.rowRect.right - t.right, `${label}: toggle at the start (right)`).toBeLessThan(24);

  // Hidden items are not focusable.
  const hiddenFocus = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll<HTMLElement>('[data-menu-row]')).find((r) => r.getClientRects().length > 0)!;
    const hidden = Array.from(row.querySelectorAll<HTMLElement>(':scope > [data-menu-row-item] > *')).filter((e) => e.getClientRects().length === 0);
    return hidden.map((e) => {
      e.focus();
      return document.activeElement === e;
    });
  });
  expect(hiddenFocus.length).toBeGreaterThan(0);
  expect(hiddenFocus.every((f) => !f), `${label}: hidden items focusable`).toBe(true);

  if (withSubmenus) await expectSubmenusOpen(page, `${label} collapsed`);

  // Expand with the keyboard.
  const toggle = page.locator('[data-menu-toggle]').first();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAttribute('aria-label', 'Show fewer menu items');
  await page.waitForTimeout(300);
  m = await readMenu(page);
  expect(m.shown, `${label}: expanded shows every item`).toBe(m.total);
  expect(m.rows, `${label}: expanded uses the minimum rows`).toBe(m.expectedRows);
  expect(m.rows).toBeGreaterThan(1);
  expect(m.allShownInside, `${label}: expanded items inside`).toBe(true);
  expect(m.pageOverflow, `${label}: expanded page scrolls sideways`).toBeLessThanOrEqual(0);
  // Content below is pushed, not covered: the header ends below the last menu line.
  const pushed = await page.evaluate(() => {
    window.scrollTo(0, 0);
    const row = Array.from(document.querySelectorAll<HTMLElement>('[data-menu-row]')).find((r) => r.getClientRects().length > 0)!;
    const header = row.closest('header')!;
    const main = document.querySelector('main') ?? header.nextElementSibling;
    return { rowBottom: row.getBoundingClientRect().bottom, mainTop: main ? main.getBoundingClientRect().top : Infinity };
  });
  expect(pushed.mainTop, `${label}: content below pushed down`).toBeGreaterThanOrEqual(pushed.rowBottom - 1);

  if (withSubmenus) await expectSubmenusOpen(page, `${label} expanded`);

  // Collapse with the keyboard again.
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.waitForTimeout(300);
  m = await readMenu(page);
  expect(m.rows, `${label}: collapse restores one row`).toBe(1);
  expect(m.shown).toBeLessThan(m.total);
}

test('a long menu: one non-scrolling row, a start-corner toggle, and a minimal wrap when expanded', async ({ page }) => {
  for (const dir of DIRS) {
    for (const width of WIDTHS) await checkLongMenu(page, width, dir, width === 390, `${width}px ${dir}`);
  }
});

// The Sections-theme header: Market puts the nav in its own header row (MenuBar inline) under a
// sticky shrinking header.
test('the same in a Sections theme header (nav inside a header row)', async ({ page }) => {
  const session = seed.session!;
  const theme = await api<{ id: number }>('/themes', { method: 'POST', body: JSON.stringify({ name: 'Menu market', fromTemplate: 'market' }) }, session);
  await api(`/themes/${theme.id}/publish`, { method: 'POST', body: '{}' }, session);
  for (const dir of DIRS) await checkLongMenu(page, 390, dir, true, `Market 390px ${dir}`);
});

// Revert-checked: the old phone menu row was overflow-x:auto (a sideways scroller).
test('the phone menu row is not a sideways scroller any more', async ({ page }) => {
  await open(page, 390, 'ltr');
  const m = await readMenu(page);
  expect(m.rowOverflowX).toBe('visible');
  expect(m.rowScrolls).toBe(false);
});

test('a short menu: everything on one row and no toggle', async ({ page }) => {
  const session = seed.session!;
  for (const id of menuItemIds.slice(2)) await api(`/menu-items/${id}`, { method: 'DELETE' }, session);
  for (const dir of DIRS) {
    for (const width of WIDTHS) {
      const label = `${width}px ${dir}, 2 items`;
      await open(page, width, dir);
      const m = await readMenu(page);
      expect(m.total).toBe(2);
      expect(m.shown, `${label}: both shown`).toBe(2);
      expect(m.rows, `${label}: one row`).toBe(1);
      expect(m.toggle, `${label}: no toggle`).toBeNull();
      expect(m.pageOverflow, `${label}: page scrolls sideways`).toBeLessThanOrEqual(0);
    }
  }
});
