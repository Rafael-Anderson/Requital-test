# WC: logical-properties codemod (audit §6-C step 1), hand-off notes

Branch `chore/logical-properties`, off `origin/main` at d748d039. Frontend only (admin/ and storefront/), no backend change, no migration, no dependency change.

The change is produced by `tools/logical-properties-codemod.js` (committed, idempotent, `--dry-run` lists every swap). I re-ran it on a pristine `git archive` of origin/main and diffed the result against the committed tree: identical, apart from the one hand-written rule in section 5.

## 1. Verified vs inferred

| Verified (measured here) | Inferred (argued, not proven) |
|---|---|
| 329 before/after screenshots, pixel-compared (section 4) | Why Chrome centres a `th` under `text-start` (section 5). The symptom and its fix are verified by pixels; the exact UA mechanism is my reading of it. |
| Every target utility emits CSS in the installed Tailwind 4.3.2 (`--verify`: 45 distinct) | That RTL step 2 will want the exceptions left physical (section 3). That is a judgement, not something I could test without RTL turned on. |
| Idempotent (second run: 0 swaps), reproducible from pristine origin/main | |

## 2. §6-C inventory check (audit lines 2892-2931) against the code

| Audit claim | Finding |
|---|---|
| "No i18n library in any of the three apps" | **True.** No `next-intl`, `i18next`, `react-intl`, `@formatjs`, `@lingui` or RTL plugin in any `package.json`. |
| "No `dir` handling" | **True.** `lang="en"` hardcoded at `admin/app/layout.tsx:52` and `storefront/app/layout.tsx:67`; no `dir` on `<html>`. The only `dir=` in either app is the legitimate `dir="rtl"` on the admin "Name in Arabic" input (`OutletBasicInfoTab.tsx:79`). |
| "the `.theme-*` class layer uses physical properties throughout" | **Overstated.** `storefront/app/globals.css` has 8 physical positioning declarations in total (nav-link underline `left`/`right`, 4 corner-ribbon offsets, the wishlist burst `left: 50%`, the floating-label `left`), plus 2 `transform-origin: left`. `admin/app/globals.css` has none. The bulk of the physical usage is Tailwind utility classes in TSX, not custom CSS. |
| "Step 1 touches roughly every component in both apps" | **Overstated.** 138 of 762 `.ts`/`.tsx`/`.css` files under app/components/lib (18%) contain a swappable physical utility: admin 104 of 491, storefront 34 of 271. 290 swaps in total. |
| "The theme system's motion tokens encode directional travel (`translateX`)" | **True, and untouched.** `storefront/app/globals.css` has 33 `translate` mentions; `lib/motion.ts` itself has none. Left for step 2 as the brief says. |
| "The header/footer preset model encodes left/right arrangements" | **True, untouched.** `HeaderRow.align: "left" \| "center" \| "right" \| "between" \| "zones"` (`storefront/lib/header-rows.ts:11`) and `block.settings.zone` are stored values, not CSS; mapping them to start/end belongs to step 2. |
| "a no-op in LTR" | **True for the swap itself, with one trap that is not in the audit** (section 5). |

## 3. Swap statistics

290 swaps in 138 files (admin 215, storefront 75): 274 Tailwind utility classes, 13 inline-style properties, 3 CSS declarations.

| Family | Swaps | Notes |
|---|---|---|
| `mr-*` / `ml-*` -> `me-*` / `ms-*` | 53 / 28 | includes `-ml-1`, `ml-auto`, `file:mr-3`, `before:-ml-1` |
| `pl-*` / `pr-*` -> `ps-*` / `pe-*` | 35 / 14 | includes the 16 `[&_ul]:pl-5` / `[&_ol]:pl-5` rich-text variants |
| `text-left` / `text-right` -> `text-start` / `text-end` | 39 / 37 | |
| `left-*` / `right-*` -> `start-*` / `end-*` | 35 / 24 | includes `-right-1`, `left-[5px]`, `before:left-0`, and the 2 test selectors counted below |
| `border-l*` / `border-r*` -> `border-s*` / `border-e*` | 6 / 2 | includes `border-l-4`, `border-l-red-500` |
| `rounded-r-lg` -> `rounded-e-lg` | 1 | |
| inline-style props (`paddingLeft`, `paddingRight`, `marginLeft`, `marginRight`) -> `*InlineStart/End` | 13 | tree-indent in `categories/page.tsx`, `TreeNode.tsx`, `MultiCombobox.tsx`; `SectionWrapper.tsx` and `theme-element-style.ts` (merchant spacing/alignment); the test that reads `style.paddingLeft` |
| CSS declarations in `storefront/app/globals.css` | 3 | nav-link underline `left` + `right`, floating-label `left` |
| (test strings, already counted in the rows above) | 2 | `FloatingCustomButtons.test.tsx` asserts `.left-5` / `.right-5` |

Every target utility was checked against the installed Tailwind (4.3.2 in both apps) with `node tools/logical-properties-codemod.js --dry-run --verify`: all 45 distinct targets emit CSS. No `space-x-*` / `divide-x-*` is affected: v4 already compiles those to logical properties. No element carries both a physical and a logical class (full swap; checked by grep after the run).

### Exceptions: left physical on purpose (22 occurrences; `node tools/logical-properties-codemod.js --exceptions` lists them)

| File | What stays | Reason |
|---|---|---|
| `storefront/components/CartDrawer.tsx` | `right-0` on the panel | Slides in from the physical right edge, with `translate-x-full` when closed. Step 2 flips it together with the translate. |
| `storefront/components/MobileNav.tsx` | `left-0` on the drawer panel; `right-1/2` on the cart badge | Drawer slides from the physical left with `-translate-x-full`. The badge is `right-1/2 translate-x-3`, a centring pair. (The hamburger button, `left-3`, did swap.) |
| `admin/components/ui/Toggle.tsx` | `left-0.5` on the thumb | Anchored left and moved by `translate-x-5`. |
| `admin/components/PresetThumbnails.tsx` | `left-1/2` | `left-1/2 -translate-x-1/2` centring. |
| `admin/components/auth/AuthCard.tsx` | `-right-12`, `dark:-right-20` | Decorative blurred glow anchored to the physical top-right corner. |
| `storefront/lib/product-badge.ts` (+ `.test.ts`) | `top-2 right-2`, `top-2 left-2`, `bottom-2 right-2`, `bottom-2 left-2` | Merchant-named physical corners (`top_left`...) coupled to the rotated ribbon CSS below. Mirroring them is one decision in step 2, not four. |
| `storefront/components/WishlistButton.tsx`, `ProductCard.tsx` | `top-2 left-2` heart, `top-2 right-2` "Out of stock" pill | Placed against those same badge corners (the secondary NEW chip is chosen to avoid the heart). Mixing a logical heart with physical badges would collide the moment RTL is on. |
| `storefront/app/globals.css` | `.theme-badge-ribbon--tr/tl/br/bl` offsets (`right: -1.9em` ...) | Diagonal corner banner: `rotate(±45deg)` is tied to the physical corner. |
| `storefront/app/globals.css` | `.theme-wishlist-anim-burst::after` `left: 50%` | Centred by the keyframe `translate(-50%, -50%)`, which the rule itself cannot show; the codemod has a named guard for it. |
| `storefront/app/globals.css` | `transform-origin: left` (nav underline, progress bar) | No logical form; belongs with the motion tokens in step 2. |
| `storefront/components/ScrollProgressBar.tsx`, `CartDrawer.tsx` | `origin-left`, `origin-right` | Same. |

Not touched because they are not reading-direction CSS (kept out of the codemod's patterns, not "swapped then reverted"): measured-rect `left:`/`right:` style objects (`Tooltip.tsx`, `ColorPicker.tsx`, `SelectionActionBar.tsx`, `SalesOverviewChart.tsx`, `PreviewInteraction.tsx`, `MenuBar.tsx` flyout, `fly-to-cart.tsx`, `DecorativeParallax.tsx`'s blob table, `PriceRangeSlider.tsx`'s `left`/`right` percentages); `scrollBy({ left })`; the `left`/`right` keys of alignment settings (`ThemeDrivenHeader.tsx` `left: "justify-start"`, `ColorPicker`/`DropdownMenu` `align` props, `"left" | "right"` enums in `lib/types`); the TipTap `setTextAlign("left")` commands (stored content, not UI chrome).

Other deliberate scope notes for step 2 (not done here): 46 directional icon usages (`ChevronLeft`/`Right`, `ArrowLeft`/`Right`...) need mirroring; 33 `translate` rules in the storefront CSS; the two `transform-origin: left`.

### Where merchant-set "left/right" now follows reading direction

These swapped, so in RTL they will mean "start/end", which is the usual convention but is a product choice worth a glance in step 2: the WhatsApp / back-to-top / custom floating buttons (`bottom_left`/`bottom_right`, `side: "left"`), `SectionWrapper` per-side padding (`spacing.left`/`spacing.right`), and `theme-element-style.ts`'s element alignment margins. LTR output is unchanged.

## 4. Visual regression proof

Harness (committed, small, not part of any CI job): `docs/handoff/wc-visual/{seed.js,capture.js,compare.js}`. Two shops seeded through the real backend API (one on the legacy layout, one with the Market template published and the cart drawer on, step-by-step checkout), 1 customer with an account and one order per shop. Production builds (`next build` + `next start`) of both apps on ports 4001/4002 against a backend on 4000. Chromium 1194, `prefers-reduced-motion`, animations and transitions disabled, clock fixed at 2026-10-01T08:00Z, timezone Asia/Dubai, third-party images replaced by a fixed 1x1 PNG, order/abandoned-cart POSTs aborted so the data is frozen, 1200 ms settle, full-page PNGs. Nothing was masked. Pixel comparison is done inside Chromium on decoded RGBA (no PNG library needed).

Coverage (329 captures per run):

* Storefront, 86: both shops, 1280x800 and 390x844: home, collection, PDP, PDP with variants, bio, order tracking, account login/register/forgot, cart, checkout (contact, contact filled, delivery, payment steps on the step-by-step shop; the single page on the other), after-add-to-cart, account home/orders/order detail/addresses/wishlist (logged in), plus open search popover, open sort dropdown, open cart drawer.
* Admin, 237: every static admin route outside `/platform` plus order detail, product edit, customer detail, outlet edit, theme builder (1280x800, both shops; 390x844 for the legacy shop), login/signup/forgot-password, and open states: user menu, nav menu, Cmd+K palette, Edit-items modal, theme builder with Hero / Header selected, the other two tabs, tablet width.
* Platform admin, 6: login, shops, audit log, settings, webhooks, home.

### Method, because "zero differing pixels" is not achievable verbatim

Two captures of the **same, unmodified** build differ on 30 of 329 pages (`beforeB` vs `beforeC`): ±1 colour level on a handful of pixels at rounded-corner / border edges (Chromium raster antialiasing is not bit-stable run to run), plus 4 pages whose height differs because the data changed between runs (the activity log gains a row per login; one wishlist state). So I measured the noise floor first and then compared the modified build against it.

| Comparison | Pages | Identical (0 px) | ≤1-level edge noise only | Significant (>2 level) | Different size |
|---|---|---|---|---|---|
| old build vs old build (noise floor) | 329 | 295 | 30 (max delta 1) | 0 | 4 (data) |
| **old build vs new build** | **329** | **298** | **28 (max delta 1)** | **0** | **3 (activity log, data)** |

By group, old vs new: storefront 85/86 identical (the 1 other: 9 pixels, max delta 1, the same pixels that the old-vs-old run also differs on, `sf-themed-d-checkout-0`); platform admin 6/6; admin 207/237 identical, 27 with ≤1-level noise, 3 activity-log pages with a different height. Every noisy pixel I sampled sits on the outer edge columns of a card or button corner (x = 48-50 / 1229-1231 / 1049-1050 / 1156-1157), i.e. rounded-corner antialiasing.

The 3 activity-log pages are not a codemod effect: capturing that page with the old and the new build against the **same** stored session and the same rows gives 2 byte-identical and 1 page with 26 pixels of ±1 noise (`actOld2` vs `actNew2`, a throwaway run, not committed).

I did not take a third capture of the new build, so the noise floor for the new build alone is inferred from the old build's, not measured.

### The bug the pixel proof found (and the injection proof for its fix)

The first new-build capture (before the fix in section 5) had **126 of 329 pages with significant differences** (32 of the 77 legacy-shop desktop admin pages alone): every table header had moved. Fix applied, rebuilt, recaptured: **0 significant**. The fix is guarded by `admin/app/globals.css.test.ts`; removing the rule makes it fail with `expected [] to deeply equal [ 'inherit' ]`, restoring it passes (both runs recorded in section 7).

## 5. The one non-mechanical thing: `text-start` on a table header's parent

`THead` (`admin/components/ui/Table.tsx`) and three platform `<thead>` elements set `text-left`. A `th` has the UA rule `text-align: -internal-center`. Measured: with the parent at `text-align: left` the header is left-aligned, with the parent at `text-align: start` (what `text-start` computes to) the header is **centred**. The swap `text-left` -> `text-start` was therefore not a no-op in LTR for any table whose alignment lives on an ancestor of the `th`. The `EMAIL` column header on Customers moved ~150px.

Fix (hand-written, the only non-codemod edit): `admin/app/globals.css` gets `@layer base { th { text-align: inherit; } }`, so headers follow the thead again, in LTR and RTL, while a `<TH className="text-end">` still wins because utilities sit above the base layer. Only `th` has this UA behaviour, `td` does not. Storefront has no tables.

`text-start` directly on a `button`, `div`, `label` or `span` (the other ~30 swaps) is unaffected: they set text-align on the element itself.

## 6. What the visual proof does not cover

Say so rather than imply it: hover and focus states; admin dark mode (class-toggled, not captured); the Atelier, Bloom and Heritage templates (only Market and the legacy layout); the mobile-nav `drawer`/`fullscreen`/`bottom-bar` modes (the default `scroll` is what ran); header rows presets; the signup and product wizards beyond their first screen; platform admin `shops/[shopId]`; storefront brands page, policies, pay, survey, cart-recover pages; non-AED shops; the theme-builder preview iframe (it showed "refused to connect" in my harness because the admin build's preview origin is not my port block, so the builder panels were captured but not the iframe). The codemod's diff on those files is covered by tsc, vitest and the class-level verification, not by pixels.

## 7. Tests, guardrails, lint

* `tsc --noEmit`: admin clean, storefront clean (`.next` deleted first).
* vitest: admin 97 files / 677 tests passed (96 / 675 + the new `admin/app/globals.css.test.ts`, 2 tests); storefront 93 files / 748 passed.
* One test needed a consistent update: `storefront/lib/theme-element-style.test.ts` asserted `style.paddingLeft/Right`; `FloatingCustomButtons.test.tsx` asserted `.left-5/.right-5`. The codemod updates both.
* `storefront/app/globals.css.test.ts` green.
* Lint baseline: admin 86 -> 86, storefront 33 -> 33 (+0, run with `node tools/check-lint-baseline.js`).
* `node tools/check-*.js`: all pass except `check-form-width.js`, which exits 1 with the same 26 pre-existing findings before and after (diffed with line numbers ignored).
* `npm run build` in both apps succeeded (admin twice: with and without the section 5 rule).
* Injection proof of the section 5 fix: (a) new build without the `th` rule vs old build: 126/329 pages significant; with the rule: 0/329. (b) unit test: rename the selector `th` -> `thx` in `admin/app/globals.css`, `npx vitest run app/globals.css.test.ts` fails 1 of 2 (`expected [] to deeply equal [ 'inherit' ]`); put it back, 2 of 2 pass.
* Injection proof of the codemod guardrail: adding `ml-2 text-left` to a scratch file makes `node tools/logical-properties-codemod.js --check` exit 1 and name both; removing it exits 0.

## 8. Deploy notes and risks

* No migration, no env var, no dependency. Admin and storefront rebuild and restart; backend untouched.
* Risk: the unfixed class of bug in section 5. If the sweep missed another "keyword start is treated differently from left" case, it would show as a layout shift in LTR. The pixel pass found exactly one (every `th`). I also read the full list of the 39 `text-start` swaps: the only ones on an ancestor of a table cell are `THead` and the three platform `thead`s (the rest are on buttons, divs, labels and spans, which set the alignment on themselves). None of the 37 `text-end` swaps is on a `thead`, `tr` or `table` (they are on `span`, `dd`, `div`, `p`, `TH`, `td`, `th` and alignment-map strings).
* Risk: the 28 old-vs-new pages with ≤1-level differences. Argued to be raster noise (same magnitude and location as the old-vs-old run) rather than proven per page.
* The exceptions leave a handful of physical edges that will not flip in RTL until step 2; they are exactly the ones listed in section 3.

## 9. Edits for CLAUDE.md (I did not touch it)

Add to the "Admin frontend" section, and mention under "Storefront frontend" that it applies there too:

> **Logical properties only (audit §6-C step 1, 2026-10-01).** Use `ms-*`/`me-*`, `ps-*`/`pe-*`, `start-*`/`end-*`, `text-start`/`text-end`, `border-s`/`border-e`, `rounded-s`/`rounded-e` (and `rounded-ss/se/es/ee`) and the `*InlineStart/End` style props, never `ml/mr/pl/pr/left/right/text-left/text-right/border-l/border-r/rounded-l/r` or `marginLeft`-style props. `node tools/logical-properties-codemod.js --check` fails (exit 1, lists each one) if a physical utility has crept back; `--dry-run` previews a fix, no flag applies it, `--verify` confirms every target utility emits CSS in the installed Tailwind, `--exceptions` lists the physical edges left on purpose (drawers, translate-centred elements, rotated ribbons, merchant-named badge corners; reasons in `docs/handoff/wc.md`). **Gotcha:** a `th` is `text-align: -internal-center`, which Chrome centres when the parent's text-align is the keyword `start`; `admin/app/globals.css` carries `@layer base { th { text-align: inherit } }` (guarded by `admin/app/globals.css.test.ts`) so a thead's `text-start` still left-aligns its headers. Do not put `text-start` on a `th`'s ancestor without that rule.

Suggested CI: add one step `node tools/logical-properties-codemod.js --check` to the existing `guardrails` job (do not rename the job). I did not edit `ci.yml`.

Audit §6-C (`docs/plans/product-capability-audit.md`) corrections for whoever owns it: "touches roughly every component" -> 138 of 762 files (18%), 290 swaps; "`.theme-*` class layer uses physical properties throughout" -> 8 physical declarations in `globals.css` (4 of them ribbon corners); and add the `th` hazard to "The specific hazard".
