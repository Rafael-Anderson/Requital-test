#!/usr/bin/env node
// Guardrail: an admin list fetch must be bounded.
//
// Every `export function list*` in admin/lib/api.ts is a request for "all the rows of
// something". If the endpoint behind it can grow without bound (orders, products,
// customers), the function must take `page`/`pageSize`/`limit`, so a page never loads
// the whole table. A list that is known to be small by nature, or that has not been
// paginated yet, is named in ALLOWLIST below with the reason, so the debt is visible
// and a NEW unbounded list fails CI instead of slipping in.
//
//   node tools/check-list-pagination.js              check
//   node tools/check-list-pagination.js --self-test  prove the detector works
//
// Heuristic by design (text, not types): it reads the function's signature and the
// first lines of its body for page|pageSize|limit.
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..', 'admin', 'lib', 'api.ts');

// name -> why it is allowed to fetch everything. Audited 2026-11-15; every entry
// without a server-side cap is a candidate for the shared Pagination component.
const ALLOWLIST = {
  // Small by nature (bounded by what a merchant configures by hand).
  listShopUsers: 'staff of one shop, a handful',
  listSessions: 'one user sessions',
  listBranchRoles: 'merchant-defined permission bundles',
  listBranchRoleAssignments: 'one assignment per staff and outlet',
  listOutlets: 'a shop has a few outlets',
  listDeliveryZones: 'zones of one outlet',
  listThemes: 'a few themes per shop',
  listThemeTemplates: 'four starter templates',
  listMenuItems: 'the storefront menu',
  listIngredientCategories: 'a small taxonomy',
  listTaxClasses: 'a few VAT classes',
  listMetafieldDefinitions: 'merchant-defined fields',
  listCollections: 'a tree the product form and filters need whole',
  listBrands: 'a few brands',
  listCustomerTags: 'merchant-defined tags',
  listCustomerSegments: 'merchant-defined segments',
  listCustomerNotes: 'notes of one customer',
  listCustomerMerges: 'merges of one customer',
  listInvoicesForOrder: 'documents of one order',
  listCreditNotesForOrder: 'documents of one order',
  listChannelProviders: 'a fixed list of providers',
  listChannelConnections: 'a few per shop',
  listChannelMappings: 'mappings of one provider',
  listSupplierSuggestions: 'derived suggestions, server capped',
  listFailedJobs: 'server capped (LIMIT) diagnostics list',
  listReadyOrders: 'orders ready at one outlet, a working set',
  listReorderLowStock: 'derived low-stock list for one outlet',
  listReorderSuggestions: 'derived suggestions for one outlet',
  getTopProducts: 'a top-N',
  // NOT bounded, NOT yet paginated: the audit list. Each fetches every row of a
  // table that grows with the shop. Fix with the shared Pagination component.
  listProducts: 'UNBOUNDED, kept for pickers and exports (the Products page uses listProductsPage)',
  listIngredients: 'UNBOUNDED (no LIMIT server side), inventory page',
  listTemplates: 'UNBOUNDED, product templates page',
  listDiscounts: 'UNBOUNDED (no LIMIT server side), discounts page',
  listGiftCards: 'UNBOUNDED (no LIMIT server side), gift cards page',
  listDraftOrders: 'UNBOUNDED (no LIMIT server side), draft orders page',
  listAbandonedCarts: 'UNBOUNDED (no LIMIT server side), abandoned carts page',
  listBioLinks: 'UNBOUNDED (no LIMIT server side), bio links page',
  listSuppliers: 'server-side LIMIT only, no paging parameters',
  listDrivers: 'no paging parameters',
  listChannelUnmappedItems: 'no paging parameters, the unmapped-items queue of one connection',
  listCampaigns: 'server-side LIMIT only, no paging parameters',
  listAuditLogActors: 'distinct staff names',
};

function findUnbounded(source) {
  const out = [];
  const re = /export (?:async )?function (list\w+)\(([\s\S]*?)\)\s*(?::[^{]+)?\{/g;
  let m;
  while ((m = re.exec(source))) {
    const name = m[1];
    const signature = m[2];
    const bodyStart = m.index + m[0].length;
    // The body ends at the first line that is just a closing brace.
    const body = source.slice(bodyStart, bodyStart + 1500).split(/\n\}/)[0];
    const PAGING = /\b(page|pageSize|limit)\b/;
    // A parameter typed by a named interface/type (params: ListOrdersParams) is
    // bounded when that declaration carries a paging field.
    const typed = [...signature.matchAll(/:\s*([A-Z]\w+)/g)].some((t) => {
      const decl = new RegExp(`(?:interface|type)\\s+${t[1]}\\b[^{=]*[={]([\\s\\S]*?)\\n\\}`).exec(source);
      return decl ? PAGING.test(decl[1]) : false;
    });
    const bounded = PAGING.test(signature) || PAGING.test(body) || typed;
    if (!bounded) out.push(name);
  }
  return out;
}

function selfTest() {
  const src = `
export function listBounded(params: { page?: number } = {}) { return 1; }
export function listWithLimit(outletId: number, limit = 20) { return 1; }
export function listLoose(outletId?: number) {
  return apiFetch("/x");
}
export function listBodyPage() {
  const q = new URLSearchParams({ page: "1" });
  return q;
}
`;
  const found = findUnbounded(src);
  const ok = JSON.stringify(found) === JSON.stringify(['listLoose']);
  if (!ok) {
    console.error('check-list-pagination --self-test FAILED, got', found);
    process.exit(1);
  }
  console.log('check-list-pagination --self-test: ok');
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const unbounded = findUnbounded(fs.readFileSync(API, 'utf8'));
const unknown = unbounded.filter((n) => !(n in ALLOWLIST));
const stale = Object.keys(ALLOWLIST).filter((n) => !unbounded.includes(n) && !/^get/.test(n));

let failed = false;
if (unknown.length) {
  failed = true;
  console.error('check-list-pagination: these admin list fetches take no page/pageSize/limit:');
  for (const n of unknown) console.error(`  ${n}`);
  console.error('Paginate the endpoint (backend/src/common/pagination.ts, admin components/ui/Pagination.tsx) or, if the list is small by nature, add it to ALLOWLIST with the reason.');
}
if (stale.length) {
  failed = true;
  console.error('check-list-pagination: ALLOWLIST entries that no longer match an unbounded list (remove them):');
  for (const n of stale) console.error(`  ${n}`);
}
if (failed) process.exit(1);
console.log(`check-list-pagination: ok (${unbounded.length} allow-listed unbounded list fetches, none new)`);
