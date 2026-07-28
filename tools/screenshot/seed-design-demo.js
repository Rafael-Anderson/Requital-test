// Seeds a realistic flower/gift demo shop for the storefront design audit —
// real (Unsplash) product photography, not placeholder URLs, since the
// default seed.ts data uses literal https://example.com/... thumbnails that
// 404 in the browser.
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
  const tag = Date.now();
  const shopSlug = `bloom-design-${tag}`;

  const signup = await api("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      shopName: "Bloom & Co.",
      subdomain: shopSlug,
      email: `bloom-design-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Shop Admin",
    }),
  });
  const adminToken = signup.accessToken;

  const outlets = await api("/outlets", {}, adminToken);
  const outletId = outlets[0].id;
  await api(`/outlets/${outletId}`, {
    method: "PATCH",
    body: JSON.stringify({ active: true, emirate: "Dubai", pickupEnabled: true, deliveryEnabled: true, deliveryRadiusKm: 20, latitude: 25.2048, longitude: 55.2708 }),
  }, adminToken);

  const categories = {};
  for (const name of ["Bouquets", "Plants", "Gifts"]) {
    categories[name] = (await api("/categories", { method: "POST", body: JSON.stringify({ name }) }, adminToken)).id;
  }

  const products = [
    {
      name: "Blush Peony & Rose Bouquet",
      price: 220,
      thumbnail: "https://images.unsplash.com/photo-1563241527-3004b7be0ffd?w=1000&q=80",
      category: "Bouquets",
      shortSummary: "A romantic mix of peonies, garden roses, and eucalyptus.",
    },
    {
      name: "Pastel Garden Bouquet",
      price: 195,
      thumbnail: "https://images.unsplash.com/photo-1596438459194-f275f413d6ff?w=1000&q=80",
      category: "Bouquets",
      shortSummary: "Soft roses, lisianthus, and carnations, hand-wrapped.",
    },
    {
      name: "Pink Tulip Bouquet",
      price: 145,
      thumbnail: "https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=1000&q=80",
      category: "Bouquets",
      shortSummary: "A dozen fresh pink tulips, arranged in a glass vase.",
    },
    {
      name: "Single Stem Tulip",
      price: 35,
      thumbnail: "https://images.unsplash.com/photo-1520763185298-1b434c919102?w=1000&q=80",
      category: "Bouquets",
      shortSummary: "One perfect tulip — a small gesture, beautifully wrapped.",
    },
    {
      name: "Mini Bonsai Gift",
      price: 165,
      thumbnail: "https://images.unsplash.com/photo-1512428813834-c702c7702b78?w=1000&q=80",
      category: "Plants",
      shortSummary: "A ficus bonsai in a ceramic pot — a gift that lasts.",
    },
    {
      name: "Cozy Candle & Succulent Set",
      price: 120,
      thumbnail: "https://images.unsplash.com/photo-1602874801007-bd458bb1b8b6?w=1000&q=80",
      category: "Gifts",
      shortSummary: "A hand-poured candle paired with a small succulent.",
    },
    {
      name: "Deluxe Gift Box",
      price: 180,
      thumbnail: "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=1000&q=80",
      category: "Gifts",
      shortSummary: "Curated treats, wrapped and ribboned, ready to send.",
    },
  ];

  for (const p of products) {
    const created = await api("/products", {
      method: "POST",
      body: JSON.stringify({
        name: p.name,
        price: p.price,
        thumbnail: p.thumbnail,
        sku: `${p.name.replace(/[^A-Za-z0-9]+/g, "-").toUpperCase()}-${tag}`,
        shortSummary: p.shortSummary,
        status: "Available",
        categoryIds: [categories[p.category]],
        trackInventory: false,
      }),
    }, adminToken);
    console.log(`Created product: ${p.name} (id=${created.id}, slug=${created.slug})`);
  }

  await api("/shop", { method: "PATCH", body: JSON.stringify({ published: true }) }, adminToken);

  console.log("\n=== DEMO SHOP READY ===");
  console.log(`shopSlug: ${shopSlug}`);
  console.log(`storefront: http://localhost:3002/${shopSlug}`);
  console.log(`admin login: bloom-design-${tag}@test.com / Passw0rd!`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
