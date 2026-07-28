// Adds Phase-2 demo content to the existing "Bloom & Co." shop: category
// images (for the new homepage category row), a multi-image gallery on one
// product, and a variant-bearing product with a deliberately low-stock
// variant (to actually exercise/screenshot the new PDP variant selector and
// low-stock messaging, which none of the Phase 1 demo products had).
const SHOP_SLUG = process.argv[2];
if (!SHOP_SLUG) {
  console.error("Usage: node seed-phase2-additions.js <shopSlug> <adminEmail>");
  process.exit(1);
}
const ADMIN_EMAIL = process.argv[3];

async function api(path_, opts = {}, token) {
  const res = await fetch(`http://localhost:3000${path_}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path_} -> ${res.status}: ${text}`);
  return body;
}

async function main() {
  const login = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: ADMIN_EMAIL, password: "Passw0rd!" }),
  });
  const adminToken = login.accessToken;

  const outlets = await api("/outlets", {}, adminToken);
  const outletId = outlets[0].id;

  const categories = await api("/categories", {}, adminToken);
  const byName = Object.fromEntries(categories.map((c) => [c.name, c]));

  const categoryImages = {
    Bouquets: "https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=800&q=80",
    Plants: "https://images.unsplash.com/photo-1512428813834-c702c7702b78?w=800&q=80",
    Gifts: "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=800&q=80",
  };
  for (const [name, image] of Object.entries(categoryImages)) {
    if (!byName[name]) continue;
    await api(`/categories/${byName[name].id}`, { method: "PATCH", body: JSON.stringify({ image }) }, adminToken);
    console.log(`Set image for category ${name}`);
  }

  // Multi-image gallery on the hero product.
  const products = await api(`/products?outletId=${outletId}`, {}, adminToken);
  const heroProduct = products.find((p) => p.name === "Blush Peony & Rose Bouquet");
  if (heroProduct) {
    await api(
      `/products/${heroProduct.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          images: [
            { url: "https://images.unsplash.com/photo-1563241527-3004b7be0ffd?w=1200&q=80", order: 0 },
            { url: "https://images.unsplash.com/photo-1596438459194-f275f413d6ff?w=1200&q=80", order: 1 },
            { url: "https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=1200&q=80", order: 2 },
          ],
        }),
      },
      adminToken,
    );
    console.log(`Added gallery images to ${heroProduct.name}`);

    // A real rich-text description (matches what admin's RichTextEditor
    // would actually save — bold/heading/list/link tags) to exercise the
    // new sanitized HTML rendering, instead of the plain shortSummary only.
    await api(
      `/products/${heroProduct.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          description:
            "<p>Hand-tied by our florists the morning of delivery, using <b>peonies, garden roses, and eucalyptus</b> sourced from our regular growers.</p><h2>What's included</h2><ul><li>9–11 stems, arranged and wrapped</li><li>Reusable glass vase</li><li>Flower food sachet</li></ul><p>Runs seasonally — availability of exact peony varieties may vary. See our <a href=\"#\">care guide</a> for tips on keeping it fresh longer.</p>",
        }),
      },
      adminToken,
    );
    console.log(`Set rich-text description on ${heroProduct.name}`);
  }

  // Low stock on a simple product, to show the "Only N left" state without
  // needing a variant.
  const tulip = products.find((p) => p.name === "Single Stem Tulip");
  if (tulip) {
    await api(`/products/${tulip.id}`, { method: "PATCH", body: JSON.stringify({ trackInventory: true }) }, adminToken);
    await api(
      "/products/stock/bulk-adjust",
      { method: "PATCH", body: JSON.stringify({ outletId, adjustments: [{ productId: tulip.id, delta: 4 }] }) },
      adminToken,
    );
    console.log(`Set low stock (4) on ${tulip.name}`);
  }

  // A variant-bearing product — nothing in the Phase 1 demo catalog had
  // options/variants, so the new tappable variant selector had nothing to
  // render against. Two options (Size, Wrap Color) exercises the up-to-3
  // system meaningfully; one variant seeded deliberately low so the
  // per-variant stock messaging has something real to show.
  const bouquetsCategoryId = byName["Bouquets"]?.id;
  const seasonal = await api(
    "/products",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Seasonal Bouquet, Made to Order",
        price: 165,
        thumbnail: "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=1000&q=80",
        sku: `SEASONAL-${Date.now()}`,
        shortSummary: "Whatever's freshest this week, in the size and wrap you choose.",
        status: "Available",
        categoryIds: bouquetsCategoryId ? [bouquetsCategoryId] : [],
        trackInventory: true,
      }),
    },
    adminToken,
  );
  console.log(`Created ${seasonal.name} (id=${seasonal.id})`);

  await api(
    `/products/${seasonal.id}/options`,
    {
      method: "PUT",
      body: JSON.stringify({
        options: [
          { name: "Size", values: ["Small", "Medium", "Large"] },
          { name: "Wrap Color", values: ["Kraft", "Blush Pink"] },
        ],
      }),
    },
    adminToken,
  );
  const withVariants = await api(`/products/${seasonal.id}?outletId=${outletId}`, {}, adminToken);
  console.log(`Generated ${withVariants.variants.length} variants`);

  // Deliberately low stock on exactly one variant (Large / Blush Pink) —
  // every other variant stays untracked-looking (0, since bulk-adjust
  // starts at 0 and we only touch this one) so the UI has both a healthy
  // and a low-stock variant to switch between.
  const target = withVariants.variants.find(
    (v) => v.label && v.label.includes("Large") && v.label.includes("Blush Pink"),
  );
  if (target) {
    await api(
      "/products/stock/bulk-adjust",
      { method: "PATCH", body: JSON.stringify({ outletId, adjustments: [{ productId: seasonal.id, variantId: target.id, delta: 2 }] }) },
      adminToken,
    );
    console.log(`Set low stock (2) on variant: ${target.label}`);
  }
  // Give the rest of the variants healthy stock so switching between them
  // is meaningful (not every variant reading "out of stock").
  for (const v of withVariants.variants) {
    if (v.id === target?.id) continue;
    await api(
      "/products/stock/bulk-adjust",
      { method: "PATCH", body: JSON.stringify({ outletId, adjustments: [{ productId: seasonal.id, variantId: v.id, delta: 25 }] }) },
      adminToken,
    );
  }
  console.log("Stocked remaining variants.");

  console.log("\nDone.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
