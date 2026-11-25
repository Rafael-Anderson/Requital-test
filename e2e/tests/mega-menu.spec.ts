import { test, expect, type Page } from '@playwright/test';
import { STOREFRONT_URL } from '../urls';
import { api, seedShop, type SeedState } from '../seed';

// The desktop mega menu: a full-viewport-width panel under the header whose groups are packed into
// as many 220-280px columns as fit, each group into the currently shortest column (so a group never
// leaves a gap under a shorter neighbour), with DOM (and Tab) order kept as the merchant's order.

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const WIDTHS = [1280, 1440, 1920, 2560] as const;
const DIRS = ['ltr', 'rtl'] as const;
const ROW_GAP = 24;
const LONG_TITLE = 'Seasonal arrangements, hand-tied bouquets and everything for a wedding';

let seed: SeedState;

test.beforeAll(async () => {
  test.setTimeout(150_000);
  seed = await seedShop();
  const session = seed.session!;
  const ids: number[] = [];
  for (let i = 0; i < 9; i++) {
    const c = await api<{ id: number }>('/collections', { method: 'POST', body: JSON.stringify({ name: `Mega ${i} ${seed.runId}` }) }, session);
    ids.push(c.id);
  }
  // Eight groups of very different heights (1 to 9 links), one with a long name.
  const linkCounts = [6, 1, 3, 9, 2, 5, 1, 4];
  const columns = linkCounts.map((n, ci) => ({
    title: ci === 2 ? LONG_TITLE : `Group ${ci + 1}`,
    sortOrder: ci,
    links: Array.from({ length: n }, (_, li) => ({ label: `G${ci + 1} link ${li + 1}`, linkType: 'COLLECTION', collectionId: ids[li % ids.length], sortOrder: li })),
  }));
  await api('/menu-items', { method: 'POST', body: JSON.stringify({ label: 'Flowers', type: 'MEGA', columns }) }, session);
  await api(
    '/menu-items',
    {
      method: 'POST',
      body: JSON.stringify({
        label: 'Gifts',
        type: 'MEGA',
        columns: [
          { title: 'Boxes', sortOrder: 0, links: [{ label: 'Gift boxes', linkType: 'COLLECTION', collectionId: ids[0], sortOrder: 0 }] },
          { title: 'Cards', sortOrder: 1, links: [{ label: 'Greeting cards', linkType: 'COLLECTION', collectionId: ids[1], sortOrder: 0 }] },
        ],
      }),
    },
    session,
  );
});

type Group = { left: number; right: number; top: number; bottom: number; titleTop: number; titleBottom: number; titleLines: number; titleFits: boolean; contentFits: boolean };
type PanelState = {
  layout: string | null;
  panelLeft: number;
  panelWidth: number;
  viewport: number;
  innerHeight: number;
  pageOverflow: number;
  panelOverflowX: number;
  groups: Group[];
};

async function readPanel(page: Page): Promise<PanelState> {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-mega-panel]')!;
    const pr = panel.getBoundingClientRect();
    const de = document.documentElement;
    const groups = Array.from(panel.querySelectorAll<HTMLElement>('[data-mega-group]')).map((g) => {
      const r = g.getBoundingClientRect();
      const title = g.querySelector('p')!;
      const tr = title.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(title).lineHeight) || 16;
      const contentFits = Array.from(g.querySelectorAll<HTMLElement>('*')).every((el) => {
        const er = el.getBoundingClientRect();
        return er.width === 0 || (er.left >= r.left - 0.5 && er.right <= r.right + 0.5);
      });
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        titleTop: tr.top,
        titleBottom: tr.bottom,
        titleLines: Math.round(tr.height / lineHeight),
        titleFits: title.scrollWidth <= title.clientWidth + 1,
        contentFits,
      };
    });
    return {
      layout: panel.getAttribute('data-mega-layout'),
      panelLeft: pr.left,
      panelWidth: pr.width,
      viewport: de.clientWidth,
      innerHeight: window.innerHeight,
      pageOverflow: de.scrollWidth - de.clientWidth,
      panelOverflowX: panel.scrollWidth - panel.clientWidth,
      groups,
    };
  });
}

async function openMega(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.locator('[data-mega-panel]').waitFor();
  // The layout is measured before first paint; give a font swap a moment to re-pack.
  await page.waitForTimeout(150);
  // Still open after the wait (a click that closed it again would make the reads below see nothing).
  await expect(page.locator('[data-mega-panel]')).toHaveCount(1);
}

async function open(page: Page, width: number, dir: 'ltr' | 'rtl') {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${STOREFRONT_URL}/${seed.subdomain}`);
  await page.getByRole('button', { name: 'Flowers', exact: true }).waitFor({ timeout: 120_000 });
  await page.evaluate((d) => {
    document.documentElement.dir = d;
    window.scrollTo(0, 0);
  }, dir);
}

// Replays the packing in DOM order: every group must land in the column that was shortest when its
// turn came, directly under that column's previous group.
function expectShortestColumnPacking(groups: Group[], label: string) {
  const areaTop = Math.min(...groups.map((g) => g.top));
  const columns = new Map<number, number>(); // column start edge -> current bottom
  const key = (g: Group) => Math.round(g.left);
  for (const g of groups) if (!columns.has(key(g)) && Math.abs(g.top - areaTop) <= 1) columns.set(key(g), areaTop - ROW_GAP);
  for (const [i, g] of groups.entries()) {
    const bottoms = [...columns.values()];
    const shortest = Math.min(...bottoms);
    const own = columns.get(key(g));
    expect(own, `${label}: group ${i + 1} is in a known column`).not.toBeUndefined();
    expect(own! - shortest, `${label}: group ${i + 1} went into the shortest column`).toBeLessThanOrEqual(1);
    expect(Math.abs(g.top - (own! + ROW_GAP)), `${label}: group ${i + 1} sits directly under its column`).toBeLessThanOrEqual(2);
    columns.set(key(g), g.bottom);
  }
}

test('the mega panel spans the viewport and packs groups into the shortest column at every desktop width', async ({ page }) => {
  for (const dir of DIRS) {
    const colsByWidth: number[] = [];
    for (const width of WIDTHS) {
      const label = `${width}px ${dir}`;
      await open(page, width, dir);
      await openMega(page, 'Flowers');
      const m = await readPanel(page);
      expect(m.layout).toBe('wide');
      expect(Math.abs(m.panelLeft), `${label}: panel starts at the viewport edge`).toBeLessThanOrEqual(1);
      expect(Math.abs(m.panelWidth - m.viewport), `${label}: panel is as wide as the viewport`).toBeLessThanOrEqual(1);
      expect(m.pageOverflow, `${label}: no page overflow`).toBeLessThanOrEqual(0);
      expect(m.panelOverflowX, `${label}: no sideways scroll in the panel`).toBeLessThanOrEqual(0);
      expect(m.groups).toHaveLength(8);

      const cols = new Set(m.groups.map((g) => Math.round(g.left))).size;
      colsByWidth.push(cols);
      for (const g of m.groups) {
        expect(g.right - g.left, `${label}: track width`).toBeLessThanOrEqual(281);
        expect(g.right - g.left, `${label}: track width`).toBeGreaterThanOrEqual(219);
        expect(g.contentFits, `${label}: nothing overflows its track`).toBe(true);
        expect(g.left >= 0 && g.right <= m.viewport, `${label}: group inside the viewport`).toBe(true);
      }
      expectShortestColumnPacking(m.groups, label);

      // The long group name wraps inside its own track.
      const long = m.groups[2];
      expect(long.titleFits, `${label}: long name not clipped`).toBe(true);
      expect(long.titleLines, `${label}: long name wraps`).toBeGreaterThan(1);

      // At scroll 0 the first row's headings are fully visible and not covered.
      const firstTop = Math.min(...m.groups.map((g) => g.top));
      for (const [i, g] of m.groups.entries()) {
        if (Math.abs(g.top - firstTop) > 1) continue;
        expect(g.titleTop, `${label}: heading ${i + 1} below the header`).toBeGreaterThanOrEqual(0);
        expect(g.titleBottom, `${label}: heading ${i + 1} on screen`).toBeLessThanOrEqual(m.innerHeight);
      }
      const covered = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('[data-mega-group] > p')).filter((p) => {
          const r = p.getBoundingClientRect();
          if (r.bottom > window.innerHeight) return false;
          const hit = document.elementFromPoint(r.left + 4, r.top + r.height / 2);
          return !hit || !p.contains(hit);
        }).length,
      );
      expect(covered, `${label}: visible headings are not covered`).toBe(0);

      // In RTL the first group is at the right.
      if (dir === 'rtl') expect(m.groups[0].right, `${label}: first group at the start (right)`).toBeGreaterThan(m.viewport / 2);
      else expect(m.groups[0].left, `${label}: first group at the start (left)`).toBeLessThan(m.viewport / 2);
    }
    // More columns on wider screens.
    for (let i = 1; i < colsByWidth.length; i++) expect(colsByWidth[i]).toBeGreaterThanOrEqual(colsByWidth[i - 1]);
    expect(colsByWidth[colsByWidth.length - 1]).toBeGreaterThan(colsByWidth[0]);
  }
});

test('Tab order follows the merchant order of groups and links, and Escape closes', async ({ page }) => {
  await open(page, 1440, 'ltr');
  await openMega(page, 'Flowers');
  const domOrder = await page.locator('[data-mega-panel] a').allTextContents();
  await page.locator('[data-mega-panel] a').first().focus();
  const seen: string[] = [];
  for (let i = 0; i < domOrder.length; i++) {
    seen.push(await page.evaluate(() => document.activeElement?.textContent ?? ''));
    await page.keyboard.press('Tab');
  }
  expect(seen).toEqual(domOrder);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-mega-panel]')).toHaveCount(0);
});

test('a two-group mega menu sits side by side across the full width', async ({ page }) => {
  for (const width of [1280, 2560]) {
    await open(page, width, 'ltr');
    await openMega(page, 'Gifts');
    const m = await readPanel(page);
    expect(Math.abs(m.panelWidth - m.viewport)).toBeLessThanOrEqual(1);
    expect(m.groups).toHaveLength(2);
    expect(Math.abs(m.groups[0].top - m.groups[1].top)).toBeLessThanOrEqual(1);
    expect(m.groups[1].left).toBeGreaterThan(m.groups[0].right);
    // A click outside closes it.
    await page.mouse.click(5, 880);
    await expect(page.locator('[data-mega-panel]')).toHaveCount(0);
  }
});

test('a mouse click after hover keeps the mega panel open', async ({ page }) => {
  await open(page, 1440, 'ltr');
  const trigger = page.getByRole('button', { name: 'Flowers', exact: true });
  await trigger.hover();
  await page.locator('[data-mega-panel]').waitFor();
  await page.waitForTimeout(50);
  await trigger.click();
  // The old toggle closed it 100ms after the click.
  await page.waitForTimeout(300);
  await expect(page.locator('[data-mega-panel]')).toHaveCount(1);
});

test('on a phone the mega menu keeps its compact flyout', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${STOREFRONT_URL}/${seed.subdomain}`);
  await page.getByRole('button', { name: 'Flowers', exact: true }).click({ timeout: 120_000 });
  await expect(page.locator('[data-mega-panel]')).toHaveAttribute('data-mega-layout', 'compact');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});

// The Sections-theme header path: Market puts the nav inside a header row (MenuBar inline).
test('the same panel from a Sections theme header', async ({ page }) => {
  const session = seed.session!;
  const theme = await api<{ id: number }>('/themes', { method: 'POST', body: JSON.stringify({ name: 'Mega market', fromTemplate: 'market' }) }, session);
  await api(`/themes/${theme.id}/publish`, { method: 'POST', body: '{}' }, session);
  for (const dir of DIRS) {
    await open(page, 1440, dir);
    await openMega(page, 'Flowers');
    const m = await readPanel(page);
    expect(m.layout).toBe('wide');
    expect(Math.abs(m.panelWidth - m.viewport)).toBeLessThanOrEqual(1);
    expect(m.pageOverflow).toBeLessThanOrEqual(0);
    expectShortestColumnPacking(m.groups, `Market 1440 ${dir}`);
  }
});
